import type { PackageCardProps } from "@/components/store/package-card";

/**
 * TEMPORARY LAYOUT DATA — DELETE IN PHASE 3.
 *
 * These are NOT real prices and must never be presented to a customer as
 * such. They exist only so the Phase 1 static shell has realistic shapes to
 * lay out against. The home page renders a visible "preview build" notice
 * alongside them for exactly this reason.
 *
 * Phase 3 replaces this module with the synced, admin-curated catalogue read
 * from MongoDB, where every price is computed server-side from
 * `basePriceUsd × exchangeRate × (1 + markup)` (Section 10).
 *
 * Section 14 requires 7–8 distinct packages to be listed for PayFast's
 * merchant review; eight tiers are stubbed here so that requirement is
 * visible in the layout from the start.
 */
export const PLACEHOLDER_PACKAGES: PackageCardProps[] = [
  { id: "ph-1", displayName: "Starter top-up", diamondAmount: 86, pricePkr: 65_000 },
  { id: "ph-2", displayName: "Small top-up", diamondAmount: 172, pricePkr: 129_000 },
  { id: "ph-3", displayName: "Popular top-up", diamondAmount: 257, pricePkr: 192_000, featured: true },
  { id: "ph-4", displayName: "Value top-up", diamondAmount: 344, pricePkr: 255_000 },
  { id: "ph-5", displayName: "Bulk top-up", diamondAmount: 429, pricePkr: 318_000 },
  { id: "ph-6", displayName: "Large top-up", diamondAmount: 706, pricePkr: 521_000 },
  { id: "ph-7", displayName: "Mega top-up", diamondAmount: 1_412, pricePkr: 1_040_000 },
  { id: "ph-8", displayName: "Ultimate top-up", diamondAmount: 2_195, pricePkr: 1_615_000 },
];
