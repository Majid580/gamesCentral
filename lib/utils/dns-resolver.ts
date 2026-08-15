import dns from "node:dns";

/**
 * Repairs a process whose DNS resolver cannot perform SRV lookups.
 *
 * `mongodb+srv://` requires an SRV record lookup, which Node performs with its
 * bundled c-ares resolver (`dns.resolveSrv`) rather than the operating system
 * resolver used by `dns.lookup`. On Windows, c-ares reads nameservers from the
 * static `NameServer` registry value per interface. When DNS is DHCP-assigned
 * the address lives in `DhcpNameServer` instead, c-ares finds no servers, and
 * silently falls back to its compiled-in default of 127.0.0.1 — where nothing
 * is listening. Every SRV query then fails with ECONNREFUSED while ordinary
 * hostname resolution keeps working, which makes the fault look like a dead
 * cluster rather than a local misconfiguration.
 *
 * This is a development-machine fault. On the Hostinger production target
 * c-ares reads /etc/resolv.conf and finds real servers, so the guard below is
 * a no-op there and in every other correctly configured environment.
 */

/** Queried only when the process has no working resolver of its own. */
const FALLBACK_RESOLVERS = ["1.1.1.1", "8.8.8.8"];

function isUnusable(server: string): boolean {
  // c-ares reports plain addresses, but may append a port (`1.1.1.1:53`) or
  // wrap IPv6 in brackets, so compare on the address portion only.
  const address = server.replace(/^\[|\]$/g, "").replace(/:\d+$/, "");
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address.startsWith("127.") ||
    address === "0.0.0.0"
  );
}

let alreadyRun = false;

/**
 * Ensures at least one reachable nameserver is configured for SRV lookups.
 *
 * Does nothing when the process already has a usable resolver — which means it
 * cannot mask a genuine DNS problem in production, only the specific
 * "no servers found, fell back to loopback" failure described above.
 *
 * Safe to call repeatedly; the work happens once per process.
 */
export function ensureSrvResolverAvailable(): void {
  if (alreadyRun) return;
  alreadyRun = true;

  const servers = dns.getServers();
  if (servers.some((server) => !isUnusable(server))) return;

  dns.setServers(FALLBACK_RESOLVERS);

  console.warn(
    `[dns] This process had no usable nameserver (saw ${JSON.stringify(servers)}), ` +
      `so SRV lookups would fail. Falling back to ${FALLBACK_RESOLVERS.join(", ")} ` +
      "for this process only.\n" +
      "[dns] Permanent fix on Windows: set a static DNS server on the active " +
      "network adapter so it is written to the registry's NameServer value, " +
      "which Node's resolver reads. This warning should never appear in production.",
  );
}
