import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";

import "./globals.css";

/*
 * "Tech Startup" pairing from the ui-ux-pro-max typography set: Space Grotesk
 * has distinctive letterforms that keep the brand from reading as a generic
 * template, while DM Sans stays highly readable at body sizes — which matters
 * on the legal and checkout pages more than anywhere else.
 */
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Games Central — Instant Mobile Legends Diamond Top-Up",
    template: "%s · Games Central",
  },
  description:
    "Buy Mobile Legends diamonds in Pakistan with instant automated delivery. Pay with EasyPaisa, JazzCash, or card. Just your Player ID and Zone ID — no account login required.",
  applicationName: "Games Central",
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Games Central",
    title: "Games Central — Instant Mobile Legends Diamond Top-Up",
    description:
      "Buy Mobile Legends diamonds in Pakistan with instant automated delivery.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf5ff" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f23" },
  ],
};

/*
 * Applies a pinned theme before first paint. Doing this after hydration would
 * flash the wrong theme on every page load, which on a payments site reads as
 * a broken page.
 *
 * A visitor who has NOT pinned a theme is deliberately left without
 * `data-theme`, so the CSS `prefers-color-scheme` query keeps tracking their
 * OS live. Wrapped in try/catch because private-browsing modes throw on
 * localStorage access.
 *
 * TODO(phase-9): needs the CSP nonce once script-src drops 'unsafe-inline' —
 * see the note in next.config.ts.
 */
const themeScript = `(function(){try{var t=localStorage.getItem('gc-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // The script above sets data-theme before React hydrates, so the client
      // <html> legitimately differs from the server's. Scoped to this element.
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${dmSans.variable} h-full`}
    >
      <head>
        {/*
          Deliberately a raw <script>, NOT next/script.

          `strategy="beforeInteractive"` was tried and rejected: Next queues
          inline content onto `self.__next_s` and replays it after the
          framework chunks load, which is well after first paint — the exact
          flash this exists to prevent. Verified in the SSR HTML.

          The cost is a React dev-only console warning about script tags in a
          component tree. The script does run (it is in the server HTML ahead
          of every app chunk); the warning is about client re-render, which
          does not apply here. Do not "fix" it back to next/script.
        */}
        <script
          id="gc-theme-boot"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
