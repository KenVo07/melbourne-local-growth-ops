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

/**
 * Route-level structured data for one validated page.
 *
 * Deliberately conservative. It emits `WebPage` and a `BreadcrumbList` built
 * from the Page Graph, and nothing else — no `Service`, `Offer`, `Review`,
 * `Product` or completed-work markup. Structured data is machine-consumed and
 * can surface in a search result stripped of the page it came from, so a
 * demonstration record must not carry a type that asserts the work happened.
 * Where a Project page is a demonstration, its disclosure travels with it in
 * `disambiguatingDescription` rather than being left behind.
 */
export function buildManagedRouteJsonLd(
  runtime: ManagedWebsiteRuntime,
  page: RuntimePageDefinition,
): Record<string, unknown> | undefined {
  const siteUrl = resolveCanonicalSiteUrl(runtime);
  if (siteUrl === undefined) return undefined;

  const { businessName } = runtime.configuration.display;
  const pageUrl = `${siteUrl}${page.path === "/" ? "" : page.path}`;
  const image = resolveRouteImageUrl(runtime, page, siteUrl);
  const disclosure = resolveDemonstrationDisclosure(runtime, page);

  const webPage: Record<string, unknown> = {
    "@type": "WebPage",
    "@id": pageUrl,
    url: pageUrl,
    name: page.metadata.title,
    description: page.metadata.description,
    isPartOf: { "@type": "WebSite", name: businessName, url: siteUrl },
    ...(image === undefined ? {} : { primaryImageOfPage: image }),
    ...(disclosure === undefined
      ? {}
      : { disambiguatingDescription: disclosure }),
  };

  const trail = breadcrumbTrail(runtime, page);
  const breadcrumb =
    trail.length < 2
      ? undefined
      : {
        "@type": "BreadcrumbList",
        itemListElement: trail.map((entry, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: entry.name,
          item: `${siteUrl}${entry.path === "/" ? "" : entry.path}`,
        })),
      };

  return {
    "@context": "https://schema.org",
    "@graph": breadcrumb === undefined ? [webPage] : [webPage, breadcrumb],
  };
}

/** The demonstration disclosure of the Project a page renders, if any. */
function resolveDemonstrationDisclosure(
  runtime: ManagedWebsiteRuntime,
  page: RuntimePageDefinition,
): string | undefined {
  if (page.content.kind !== "PROJECT") return undefined;
  const projectId = page.content.projectId;
  const project = runtime.projects?.projects.find(
    (candidate) => candidate.projectId === projectId,
  );
  return project?.truthMode === "DEMONSTRATION"
    ? project.demonstrationDisclosure
    : undefined;
}

/**
 * Home, then the page's declared parent chain, then the page.
 *
 * Names come from the Page Graph's navigation labels where one points at the
 * page, and fall back to the page's own metadata title — never to a heading,
 * which is display copy the client may rewrite independently.
 */
function breadcrumbTrail(
  runtime: ManagedWebsiteRuntime,
  page: RuntimePageDefinition,
): readonly { name: string; path: string }[] {
  const graph = runtime.pageGraph;
  if (graph === undefined) return [];
  const byId = new Map(graph.pages.map((entry) => [entry.pageId, entry]));
  const labelFor = (pageId: string): string | undefined =>
    [...graph.navigation.primary, ...graph.navigation.footer].find(
      (item) => item.target.kind === "ROUTE" && item.target.pageId === pageId,
    )?.label;

  const chain: { name: string; path: string }[] = [];
  let current: RuntimePageDefinition | undefined = page;
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(current.pageId)) {
    seen.add(current.pageId);
    chain.unshift({
      name: labelFor(current.pageId) ?? current.metadata.title,
      path: current.path,
    });
    current =
      current.parentPageId === undefined
        ? undefined
        : byId.get(current.parentPageId);
  }

  const home = byId.get(graph.homePageId);
  if (home !== undefined && !seen.has(home.pageId)) {
    chain.unshift({ name: "Home", path: home.path });
  }
  return chain;
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
    // Absolute, because the layout applies a site-wide title template and the
    // page title already carries the business name exactly once.
    title: { absolute: title },
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
