import type { ModuleKey, SectorKey } from "@/lib/entitlements/modules";

export type ProductKey = "cosmos" | "pontis" | "fieldservices";

export type ProductProfile = {
  key: ProductKey;
  /** User-facing product name, e.g. "COSMOS", "Pontis". */
  name: string;
  /** Browser tab / <title> + metadata title. */
  title: string;
  /** One-line description (metadata + manifest). */
  description: string;
  /** Short tagline shown under the mark on the login screen. */
  tagline: string;
  /** Path under /public to the square brand mark PNG. */
  markSrc: string;
  /** PWA + browser theme color (top-of-viewport chrome). */
  themeColor: string;
  /** PWA manifest background color. */
  backgroundColor: string;
  /** Name of the in-app AI assistant, e.g. "COSMOS Agent". */
  agentName: string;
  /** Spoken wake phrase, lowercase, matched by the recognizer. */
  wakePhrase: string;
  /** Display form of the wake phrase, e.g. "Hey Cosmo". */
  wakeWord: string;
  /** Default TenantClass for orgs created on this product. */
  defaultTenantClass: "GOV" | "COMMERCIAL";
  /** Container signing mode used by the release pipeline. */
  signingMode: "kms" | "keyless";
  /** Default module allowlist for a new org on this product. `null` = all modules. */
  defaultEnabledModules: ModuleKey[] | null;
  /** Default sector allowlist for a new org. `null` = all sectors. */
  defaultEnabledSectors: SectorKey[] | null;
  /** Registry ID of the skin applied by default for this product. */
  defaultSkinId: string;
  /** Plugins auto-enabled for a new org on this product (fail-closed axis: absent =
   *  none). Slugs must exist in the plugin registry (src/lib/plugins/registry.ts);
   *  slugs whose plugin isn't composed into this build are ignored at provision time. */
  defaultEnabledPlugins: string[];
};

export const PRODUCT_PROFILES: Record<ProductKey, ProductProfile> = {
  cosmos: {
    key: "cosmos",
    name: "COSMOS",
    title: "COSMOS — Enterprise Project Management",
    description:
      "Multi-tenant project management platform with boards, OKRs, CRM, and more.",
    tagline: "Enterprise Project Management",
    markSrc: "/cosmos-mark.png",
    themeColor: "#0B0E1A",
    backgroundColor: "#0B0E1A",
    agentName: "COSMOS Agent",
    // "hey cosmo" is a substring of the old "hey cosmos", so legacy utterances
    // still wake it — muscle memory keeps working.
    wakePhrase: "hey cosmo",
    wakeWord: "Hey Cosmo",
    defaultTenantClass: "GOV",
    signingMode: "kms",
    defaultEnabledModules: null,
    defaultEnabledSectors: null,
    defaultSkinId: "universe",
    defaultEnabledPlugins: [],
  },
  pontis: {
    key: "pontis",
    name: "Pontis",
    title: "Pontis — one interface for your practice",
    description:
      "One interface for an architecture practice — projects, proposals, billing, and client portal in one AI-native place.",
    tagline: "Architecture & Design",
    markSrc: "/pontis-mark.png",
    themeColor: "#f9f7f4",
    backgroundColor: "#f9f7f4",
    agentName: "Pontis Agent",
    wakePhrase: "hey pontis",
    wakeWord: "Hey Pontis",
    defaultTenantClass: "COMMERCIAL",
    signingMode: "keyless",
    defaultEnabledModules: null,
    defaultEnabledSectors: ["aec"],
    defaultSkinId: "atelier",
    defaultEnabledPlugins: ["pontis"],
  },
  // The field-services FACE is the vertical, not one customer. Jet Seal is org #1
  // on it, and its brand arrives per-org (`resolveBrand(org)` + the org's
  // `defaultSkinId` → the `jss` skin), NOT from this profile — otherwise
  // contractor #2 inherits a competitor's livery.
  fieldservices: {
    key: "fieldservices",
    name: "Field Services",
    title: "Field Services — quote to cash for trade contractors",
    description:
      "One place to run a trade contractor — jobs, quotes, crews, and invoicing, from the first call to the paid invoice.",
    tagline: "Trade Contracting",
    markSrc: "/fieldservices-mark.png",
    themeColor: "#1a1a1a",
    backgroundColor: "#1a1a1a",
    agentName: "Field Agent",
    wakePhrase: "hey field",
    wakeWord: "Hey Field",
    defaultTenantClass: "COMMERCIAL",
    signingMode: "keyless",
    defaultEnabledModules: null,
    defaultEnabledSectors: ["field-services"],
    // The generic rugged look. A customer overrides per-org — Jet Seal to `jss`.
    defaultSkinId: "field",
    // Deliberately empty. Snow (Phase 5, ADR 0003) is common but not universal —
    // a striping-only contractor should not inherit it. Orgs opt in from
    // Settings → Plugins, which is what fail-closed enablement is for.
    defaultEnabledPlugins: [],
  },
};
