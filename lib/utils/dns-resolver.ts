import dns from "node:dns";
import { Resolver } from "node:dns/promises";

/**
 * Makes `mongodb+srv://` connection strings work on a host whose default DNS
 * resolver cannot perform SRV lookups.
 *
 * BACKGROUND. `mongodb+srv://` requires an SRV record lookup, which Node
 * performs with its bundled c-ares resolver (`dns.resolveSrv`) rather than the
 * operating system resolver behind `dns.lookup`. On Windows, c-ares reads
 * nameservers from the static `NameServer` registry value; when DNS is
 * DHCP-assigned the address lives in `DhcpNameServer` instead, c-ares finds no
 * servers, and falls back to its compiled-in default of 127.0.0.1 where
 * nothing is listening. Ordinary hostname resolution keeps working while every
 * SRV query dies with `querySrv ECONNREFUSED`, which reads like a dead cluster
 * rather than a local misconfiguration.
 *
 * WHY NOT `dns.setServers()`. That was the first fix and it is not reliable:
 * it repairs the process-wide default resolver only if it runs before anything
 * else in the process touches DNS. In a standalone script it does. Inside the
 * Next.js dev server, Next resolves hostnames during boot, so the default
 * channel is already initialised against the dead 127.0.0.1 by the time any
 * application module loads — and reconfiguring it afterwards did not take
 * effect. Verified directly: with the process resolvers reading
 * ["1.1.1.1","8.8.8.8"], the global `dns.resolveSrv` still returned
 * ECONNREFUSED while a fresh `Resolver` instance pointed at the same server
 * returned all three shard records.
 *
 * SO: do the lookup on a private `Resolver` instance we construct ourselves,
 * and rewrite the URI into the equivalent non-SRV form the driver can dial
 * without any SRV lookup of its own. That is order-independent and touches no
 * global state.
 *
 * On a correctly configured host — including the Linux production target,
 * where c-ares reads /etc/resolv.conf — the probe below succeeds and the
 * original `mongodb+srv://` URI is returned untouched. The seam cannot mask a
 * genuine DNS failure in production because it only engages once the default
 * resolver has already proved it cannot do SRV at all.
 */

/** Queried only when the host's own resolver has already failed. */
const FALLBACK_RESOLVERS = ["1.1.1.1", "8.8.8.8"];

const SRV_URI = /^mongodb\+srv:\/\/(?:([^@]*)@)?([^/?]+)(\/[^?]*)?(?:\?(.*))?$/;

/** Cached per process: the rewrite costs two DNS queries, so do it once. */
let rewritten: Promise<string> | null = null;

/**
 * Returns a connection URI the local MongoDB driver can actually dial.
 *
 * Pass-through for anything that is not `mongodb+srv://`, and for any host
 * whose resolver handles SRV normally.
 */
export function resolveMongoUri(uri: string): Promise<string> {
  if (!uri.startsWith("mongodb+srv://")) return Promise.resolve(uri);
  rewritten ??= rewriteIfSrvBroken(uri);
  return rewritten;
}

async function rewriteIfSrvBroken(uri: string): Promise<string> {
  const parts = SRV_URI.exec(uri);
  if (!parts) {
    throw new Error("DATABASE_URL is not a valid mongodb+srv:// connection string.");
  }

  const [, userInfo, host, path, query] = parts;
  const srvName = `_mongodb._tcp.${host}`;

  // Probe the default resolver. If it can do SRV, change nothing — production
  // keeps using the SRV record, which is what lets Atlas move or rescale shard
  // hosts without a configuration change.
  try {
    await dns.promises.resolveSrv(srvName);
    return uri;
  } catch {
    // Fall through and rewrite.
  }

  const resolver = new Resolver({ timeout: 5_000, tries: 2 });
  resolver.setServers(FALLBACK_RESOLVERS);

  const [records, txtChunks] = await Promise.all([
    resolver.resolveSrv(srvName),
    resolver.resolveTxt(host).catch(() => [] as string[][]),
  ]);

  if (records.length === 0) {
    throw new Error(`No SRV records for ${srvName}; cannot reach the cluster.`);
  }

  const hosts = records
    .map((r) => `${r.name}:${r.port}`)
    .sort()
    .join(",");

  /*
   * Option precedence follows the MongoDB connection-string spec: options in
   * the TXT record are defaults, and anything written in the URI overrides
   * them. `tls=true` is appended last because `mongodb+srv://` implies TLS
   * while `mongodb://` does not — dropping it would silently downgrade the
   * connection to plaintext, which is the one mistake this rewrite must never
   * make.
   */
  const options = new URLSearchParams(txtChunks.map((c) => c.join("")).join("&"));
  for (const [key, value] of new URLSearchParams(query ?? "")) {
    options.set(key, value);
  }
  options.set("tls", "true");

  console.warn(
    `[dns] This host cannot resolve SRV records, so ${host} was expanded to ` +
      `its ${records.length} shard hosts directly for this process. ` +
      "Permanent fix on Windows: set a static DNS server on the active network " +
      "adapter so Node's resolver can read it. Should never appear in production.",
  );

  return `mongodb://${userInfo ? `${userInfo}@` : ""}${hosts}${path ?? "/"}?${options}`;
}
