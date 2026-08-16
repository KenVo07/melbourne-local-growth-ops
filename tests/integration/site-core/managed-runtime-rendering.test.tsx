import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emitManagedAnalyticsEvent } from "../../../apps/managed-web/src/analytics/managed-analytics";
import { ga4Initialization } from "../../../apps/managed-web/src/analytics/Ga4Runtime";
import {
  composeCurrentManagedWebsite,
  managedWebsiteRenderers,
} from "../../../apps/managed-web/src/managed-website";
import { ManagedWebsiteShell } from "../../../apps/managed-web/src/rendering";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("managed website production runtime", () => {
  it("renders booking and lead-form modules without serializing delivery PII", () => {
    const html = renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={composeCurrentManagedWebsite()}
        renderers={managedWebsiteRenderers}
      />,
    );

    expect(html).toContain("Request a service time");
    expect(html).toContain("Tell us how we can help");
    expect(html).toContain('name="email"');
    expect(html).toContain('name="message"');
    expect(html).not.toContain("owner@harbour-electrical.example.com.au");
    expect(html).not.toContain("website@harbour-electrical.example.com.au");
    expect(html).not.toContain("resend-harbour-electrical");
  });

  it("loads only the validated client-owned GA4 reference and strips query data from page-view location", () => {
    const composition = composeCurrentManagedWebsite();
    const analytics = composition.regions
      .flatMap(({ modules }) => modules)
      .find(({ type }) => type === "ANALYTICS");
    expect(analytics?.connector).toMatchObject({
      type: "GOOGLE_ANALYTICS_4",
      accountOwner: "CLIENT",
      portability: "CLIENT_OWNED",
      measurementId: "G-MLGO123456",
    });

    const initialization = ga4Initialization("G-MLGO123456");
    expect(initialization).toContain("G-MLGO123456");
    expect(initialization).toContain(
      "window.location.origin + window.location.pathname",
    );
    expect(initialization).not.toContain("window.location.search");
    expect(initialization).not.toContain("window.location.hash");
  });

  it("does not load analytics when the generated client has no analytics module", () => {
    const composition = composeCurrentManagedWebsite();
    const analyticsDisabled = {
      ...composition,
      regions: composition.regions.map((region) =>
        region.regionId === "analytics"
          ? { ...region, modules: [] }
          : region,
      ),
    };
    const html = renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={analyticsDisabled}
        renderers={managedWebsiteRenderers}
      />,
    );

    expect(html).not.toContain("googletagmanager.com");
    expect(html).not.toContain("G-MLGO123456");
  });

  it("provides a skip link, section navigation, and footer with no invented content or analytics-region label", () => {
    const composition = composeCurrentManagedWebsite();
    const html = renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={composition}
        renderers={managedWebsiteRenderers}
      />,
    );

    expect(html).toContain('class="skip-to-content"');
    expect(html).toContain('href="#primary-content"');
    expect(html).toContain('<nav aria-label="Section navigation"');
    expect(html).toContain("<footer");
    expect(html).toContain('class="site-footer-business"');
    if (composition.profile !== undefined) {
      for (const section of composition.profile.sections) {
        expect(html).toContain(`href="#${section.sectionId}"`);
      }
    }
    expect(html).not.toContain("foundation-search-trigger");
    expect(html).not.toContain("Search this website");
    expect(html).not.toContain('aria-label="analytics modules"');
  });

  it("renders the Foundation Search trigger only for a resolved enabled index", () => {
    const composition = composeCurrentManagedWebsite();
    const searchEnabled = {
      ...composition,
      foundationSearch: {
        ...composition.foundationSearch,
        mode: "ON" as const,
        enabled: true,
        reason: "EXPLICIT_ON" as const,
        records: [
          {
            url: "/#services",
            content: "Public services content",
            language: "en" as const,
            meta: {
              title: "Services",
              businessName: composition.configuration.display.businessName,
              sectionId: "services",
              profile: "CONTRACTOR",
            },
            filters: {
              profile: ["CONTRACTOR"],
              sectionType: ["SERVICES"],
            },
          },
        ],
      },
    };

    const html = renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={searchEnabled}
        renderers={managedWebsiteRenderers}
      />,
    );

    expect(html).toContain("foundation-search-trigger");
    expect(html).toContain("Search this website");
    expect(html).toContain('/pagefind/foundation-search.js');
    expect(html).not.toContain('/pagefind/pagefind.js');
  });

  it("emits conversion names without form values or technical identifiers", () => {
    const calls: unknown[][] = [];
    vi.stubGlobal("window", {
      gtag: (...arguments_: unknown[]) => calls.push(arguments_),
    });

    emitManagedAnalyticsEvent("generate_lead");

    expect(calls).toEqual([["event", "generate_lead"]]);
    expect(JSON.stringify(calls)).not.toContain("email");
    expect(JSON.stringify(calls)).not.toContain("submission");
  });
});
