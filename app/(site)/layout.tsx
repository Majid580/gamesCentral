import { ScrollReveal } from "@/components/site/scroll-reveal";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

/**
 * Chrome for every customer-facing page. `(site)` is a route group, so it adds
 * no URL segment — `app/(site)/page.tsx` is still `/`. The admin area lives
 * outside this group and gets its own, separate chrome.
 */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <ScrollReveal />
    </>
  );
}
