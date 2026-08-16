import type { Metadata } from "next";

import type {
  ManagedWebsiteRuntime,
  RuntimePageDefinition,
  RuntimeProfileSection,
  RuntimeWebsiteConfiguration,
  RuntimeWebsiteProfile,
} from "./runtime-types";

const profileSchemaType: Record<RuntimeWebsiteProfile, string> = {
  CONTRACTOR: "HomeAndConstructionBusiness",
  RESTAURANT: "Restaurant",
  RETAILER: "Store",
};

export function resolveCanonicalHostname(
  configuration: RuntimeWebsiteConfiguration,
): string | undefined {
  const canonicalDomain = configuration.domains.find(
    (domain) => domain.canonical,
  );
  return (canonicalDomain ?? configuration.domains[0])?.hostname;
}

export function resolveCanonicalSiteUrl(
  runtime: ManagedWebsiteRuntime,
): string | undefined {
  const hostname = resolveCanonicalHostname(runtime.configuration);
  return hostname === undefined ? undefined : `https://${hostname}`;
}

export function buildManagedWebsiteMetadata(
  runtime: ManagedWebsiteRuntime,
): Metadata {
  const { businessName, tagline } = runtime.configuration.display;
  const siteUrl = resolveCanonicalSiteUrl(runtime);
  const heroImageUrl = resolveHeroImageUrl(runtime, siteUrl);

  return {
    title: {
      default: businessName,
      template: `%s | ${businessName}`,
    },
    ...(tagline === undefined ? {} : { description: tagline }),
    ...(siteUrl === undefined ? {} : { alternates: { canonical: siteUrl } }),
    openGraph: {
      type: "website",
      siteName: businessName,
      title: businessName,
      ...(siteUrl === undefined ? {} : { url: siteUrl }),
      ...(tagline === undefined ? {} : { description: tagline }),
      ...(heroImageUrl === undefined
        ? {}
        : { images: [{ url: heroImageUrl }] }),
    },
  };
}

export function buildManagedWebsiteJsonLd(
  runtime: ManagedWebsiteRuntime,
): Record<string, unknown> | undefined {
  const siteUrl = resolveCanonicalSiteUrl(runtime);
  if (siteUrl === undefined) return undefined;

  const { businessName, tagline } = runtime.configuration.display;
  const profile = runtime.profile;
  const telephone = resolveConfiguredPhoneNumber(runtime);
  const address = resolveConfiguredAddress(runtime);
  const openingHours = resolveHoursText(runtime);
  const image = resolveHeroImageUrl(runtime, siteUrl);

  return {
    "@context": "https://schema.org",
    "@type":
      profile === undefined
        ? "LocalBusiness"
        : profileSchemaType[profile.profile],
    name: businessName,
    url: siteUrl,
    ...(tagline === undefined ? {} : { description: tagline }),
    ...(telephone === undefined ? {} : { telephone }),
    ...(image === undefined ? {} : { image }),
    ...(address === undefined ? {} : { address }),
    ...(openingHours === undefined ? {} : { openingHours }),
  };
}

export function serializeStructuredData(
  jsonLd: Record<string, unknown>,
): string {
  return JSON.stringify(jsonLd).replaceAll("<", "\\u003c");
}

function resolveHeroImageUrl(
  runtime: ManagedWebsiteRuntime,
  siteUrl: string | undefined,
): string | undefined {
  if (siteUrl === undefined) return undefined;
  const hero = runtime.assets.find((asset) => asset.slotId === "hero");
  return hero === undefined ? undefined : `${siteUrl}${hero.asset.publicPath}`;
}

function findSections<Type extends RuntimeProfileSection["type"]>(
  runtime: ManagedWebsiteRuntime,
  type: Type,
): readonly Extract<RuntimeProfileSection, { type: Type }>[] {
  return (runtime.profile?.sections ?? []).filter(
    (section): section is Extract<RuntimeProfileSection, { type: Type }> =>
      section.type === type,
  );
}

function resolveConfiguredPhoneNumber(
  runtime: ManagedWebsiteRuntime,
): string | undefined {
  for (const section of findSections(runtime, "ACTIONS")) {
    const phoneAction = section.actions.find(
      (action) => action.kind === "PHONE" && action.state === "CONFIGURED",
    );
    if (phoneAction?.href?.startsWith("tel:") === true) {
      return phoneAction.href.slice("tel:".length);
    }
  }
  return undefined;
}

function resolveConfiguredAddress(
  runtime: ManagedWebsiteRuntime,
): Record<string, unknown> | undefined {
  const [section] = findSections(runtime, "LOCATION");
  if (section === undefined) return undefined;
  const { location } = section;
  return {
    "@type": "PostalAddress",
    streetAddress: location.addressLines.join(", "),
    addressLocality: location.locality,
    addressRegion: location.region,
    postalCode: location.postalCode,
  };
}

function resolveHoursText(
  runtime: ManagedWebsiteRuntime,
): readonly string[] | undefined {
  const [section] = findSections(runtime, "HOURS");
  if (section === undefined) return undefined;
  return section.periods.map((period) => `${period.days} ${period.hours}`);
}


/**
 * Route-aware metadata for one validated page.
 *
 * Every value comes from the validated Page Graph, so each route gets a unique
 * title, description and canonical URL. Authored client source never supplies
 * head markup; it supplies validated data and the Kernel converts it.
 */
export function buildManagedRouteMetadata(
  runtime: ManagedWebsiteRuntime,
  page: RuntimePageDefinition,
): Metadata {
  const { businessName } = runtime.configuration.display;
  const siteUrl = resolveCanonicalSiteUrl(runtime);
  const title = page.metadata.title.includes(businessName)
    ? page.metadata.title
    : `${page.metadata.title} | ${businessName}`;
  const canonicalPath = page.path === "/" ? "" : page.path;
  const canonicalUrl =
    siteUrl === undefined ? undefined : `${siteUrl}${canonicalPath}`;
  const openGraphImageUrl = resolveRouteImageUrl(runtime, page, siteUrl);

  return {
    title,
    description: page.metadata.description,
    ...(canonicalUrl === undefined
      ? {}
      : { alternates: { canonical: canonicalUrl } }),
    openGraph: {
      title,
      description: page.metadata.description,
      type: "website",
      siteName: businessName,
      ...(canonicalUrl === undefined ? {} : { url: canonicalUrl }),
      ...(openGraphImageUrl === undefined
        ? {}
        : { images: [{ url: openGraphImageUrl }] }),
    },
  };
}

function resolveRouteImageUrl(
  runtime: ManagedWebsiteRuntime,
  page: RuntimePageDefinition,
  siteUrl: string | undefined,
): string | undefined {
  const assetId = page.metadata.openGraphImageAssetId;
  if (assetId === undefined || siteUrl === undefined) return undefined;
  const asset = runtime.assetManifest?.assets.find(
    (candidate) => candidate.assetId === assetId,
  );
  return asset === undefined ? undefined : `${siteUrl}${asset.publicPath}`;
}
