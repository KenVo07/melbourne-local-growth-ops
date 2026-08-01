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
