import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createClientExperiencePlatformComponents } from "../../../apps/managed-web/src/client-experience/platform-components";
import type { ClientExperienceResolvedMedia } from "../../../apps/managed-web/src/client-experience/contract";
import type {
  RuntimeExternalAction,
  RuntimeMediaReference,
} from "../../../apps/managed-web/src/runtime-types";

const heroReference: RuntimeMediaReference = {
  assetId: "projects/northcote/hero",
  role: "PROJECT",
  decorative: false,
  alt: "Warm evening light across a renovated terrace facade",
  presentation: {
    aspect: "LANDSCAPE",
    fit: "COVER",
    focalPoint: { x: 0.3, y: 0.4 },
    mobile: { focalPoint: { x: 0.62, y: 0.25 } },
  },
};

const decorativeReference: RuntimeMediaReference = {
  assetId: "texture/grain",
  role: "DECORATIVE",
  decorative: true,
  alt: "",
  presentation: { aspect: "SQUARE", fit: "COVER" },
};

const media: readonly ClientExperienceResolvedMedia[] = [
  {
    reference: heroReference,
    src: "/assets/projects/northcote/hero.webp",
    width: 2400,
    height: 1600,
    mediaType: "image/webp",
  },
  {
    reference: decorativeReference,
    src: "/assets/texture/grain.webp",
    width: 600,
    height: 600,
    mediaType: "image/webp",
  },
];

const actions: ReadonlyMap<string, RuntimeExternalAction> = new Map([
  [
    "call",
    {
      actionId: "call",
      kind: "PHONE",
      label: "Call the studio",
      state: "CONFIGURED",
      href: "tel:+61355500001",
    } satisfies RuntimeExternalAction,
  ],
  [
    "book",
    {
      actionId: "book",
      kind: "RESERVATION",
      label: "Book a consultation",
      state: "NOT_CONFIGURED",
      message: "Online booking is not connected yet. Call the studio instead.",
    } satisfies RuntimeExternalAction,
  ],
]);

function platformComponents(
  overrides: Partial<
    Parameters<typeof createClientExperiencePlatformComponents>[0]
  > = {},
) {
  return createClientExperiencePlatformComponents({
    media,
    actions,
    knownRegionIds: new Set(["contact"]),
    renderRegion: (regionId) => <span>{regionId} module</span>,
    search: { enabled: true, businessName: "Northline Electric" },
    ...overrides,
  });
}

describe("PlatformLink", () => {
  it("accepts internal routes, root and route anchors", () => {
    const platform = platformComponents();
    for (const href of [
      "/",
      "/projects",
      "/projects/project-one",
      "/#proof",
      "/projects#gallery",
      "#gallery",
    ]) {
      expect(
        renderToStaticMarkup(
          <platform.Link href={href}>Destination</platform.Link>,
        ),
      ).toContain(`href="${href}"`);
    }
  });

  it("rejects every external and executable href", () => {
    const platform = platformComponents();
    for (const href of [
      "https://example.com",
      "//example.com",
      "tel:+61355500001",
      "mailto:hello@example.com",
      "javascript:alert(1)",
      "/Projects",
      "/projects?preview=1",
    ]) {
      expect(() =>
        renderToStaticMarkup(<platform.Link href={href}>Bypass</platform.Link>),
      ).toThrow(/validated internal route/);
    }
  });
});

describe("PlatformImage", () => {
  it("renders client-owned alt text and responsive focal points", () => {
    const platform = platformComponents();
    const markup = renderToStaticMarkup(
      <platform.Image reference={heroReference} sizes="(max-width: 48rem) 100vw, 60vw" />,
    );

    expect(markup).toContain(
      "Warm evening light across a renovated terrace facade",
    );
    expect(markup).toContain("--platform-media-position-desktop:30% 40%");
    expect(markup).toContain("--platform-media-position-mobile:62% 25%");
    // Tablet has no override, so it inherits the base focal point.
    expect(markup).toContain("--platform-media-position-tablet:30% 40%");
    expect(markup).toContain('data-platform-media-role="project"');
  });

  it("publishes fit and focal points as overridable custom properties, not inline styles", () => {
    const platform = platformComponents();
    const markup = renderToStaticMarkup(
      <platform.Image reference={heroReference} sizes="60vw" />,
    );

    // The behavioural inputs travel as custom properties so the stylesheet can
    // resolve them per viewport tier. Inline object-position would outrank every
    // stylesheet and freeze the desktop focal point at every width.
    expect(markup).toContain("--platform-media-fit:cover");
    expect(markup).not.toMatch(/style="[^"]*[^-]object-position:/);
    expect(markup).not.toMatch(/style="[^"]*[^-]object-fit:/);
  });

  it("carries the marker the safe responsive stylesheet targets", () => {
    const platform = platformComponents();
    const markup = renderToStaticMarkup(
      <platform.Image reference={heroReference} sizes="60vw" />,
    );

    // platform-media.css keys entirely off this attribute. Losing it would
    // silently remove overflow safety from every client image.
    expect(markup).toContain("data-platform-media-role=");
  });

  it("renders decorative media with an empty alt and hides it from assistive tech", () => {
    const platform = platformComponents();
    const markup = renderToStaticMarkup(
      <platform.Image reference={decorativeReference} sizes="20vw" />,
    );

    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
  });

  it("requires composition to supply a meaningful sizes value", () => {
    const platform = platformComponents();
    expect(() =>
      renderToStaticMarkup(
        <platform.Image reference={heroReference} sizes="   " />,
      ),
    ).toThrow(/non-empty sizes/);
  });

  it("refuses media that is not part of the validated set", () => {
    const platform = platformComponents({ media: [] });
    expect(() =>
      renderToStaticMarkup(
        <platform.Image reference={heroReference} sizes="100vw" />,
      ),
    ).toThrow(/validated media set/);
  });
});

describe("PlatformRegion", () => {
  it("rejects unknown and duplicate region placement", () => {
    const platform = platformComponents();
    expect(() =>
      renderToStaticMarkup(<platform.Region regionId="missing" />),
    ).toThrow(/unknown region/);
    expect(
      renderToStaticMarkup(<platform.Region regionId="contact" />),
    ).toContain("contact module");
    expect(() =>
      renderToStaticMarkup(<platform.Region regionId="contact" />),
    ).toThrow(/more than once/);
  });

  it("tracks duplicate placement per component set, not globally", () => {
    const first = platformComponents();
    const second = platformComponents();
    expect(
      renderToStaticMarkup(<first.Region regionId="contact" />),
    ).toContain("contact module");
    // A separate render gets a fresh tracker, so the same region is placeable.
    expect(
      renderToStaticMarkup(<second.Region regionId="contact" />),
    ).toContain("contact module");
  });
});

describe("PlatformSearch", () => {
  it("renders the search entry point when search is enabled", () => {
    const platform = platformComponents();
    const markup = renderToStaticMarkup(<platform.Search />);

    expect(markup).toContain("data-platform-search");
    expect(markup).toContain("Search this website");
  });

  it("renders nothing at all when search is disabled", () => {
    const platform = platformComponents({
      search: { enabled: false, businessName: "Northline Electric" },
    });

    // An authored route may place search unconditionally; a disabled site must
    // still ship no search markup, controller or request.
    expect(renderToStaticMarkup(<platform.Search />)).toBe("");
  });
});

describe("PlatformAction", () => {
  it("renders a configured action as a real link", () => {
    const platform = platformComponents();
    const markup = renderToStaticMarkup(<platform.Action actionId="call" />);

    expect(markup).toContain('href="tel:+61355500001"');
    expect(markup).toContain("Call the studio");
    expect(markup).toContain('data-action-state="CONFIGURED"');
  });

  it("keeps an unconfigured action truthful instead of rendering a dead link", () => {
    const platform = platformComponents();
    const markup = renderToStaticMarkup(<platform.Action actionId="book" />);

    expect(markup).not.toContain("href=");
    expect(markup).toContain("Online booking is not connected yet");
    expect(markup).toContain('role="status"');
  });

  it("refuses an action the validated profile does not declare", () => {
    const platform = platformComponents();
    expect(() =>
      renderToStaticMarkup(<platform.Action actionId="invented" />),
    ).toThrow(/unknown external action/);
  });
});

describe("platform-media.css — safe responsive mechanics", () => {
  const stylesheet = readFileSync(
    fileURLToPath(
      new URL(
        "../../../apps/managed-web/src/client-experience/platform-media.css",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  it("prevents a large client asset from overflowing its composition", () => {
    // The Gate A failure: a 2400px asset rendered at intrinsic width and pushed
    // the document wider than the viewport at 1440, 390 and 320.
    expect(stylesheet).toMatch(/max-width:\s*100%/);
    expect(stylesheet).toMatch(/height:\s*auto/);
  });

  it("stays zero-specificity so authored composition can override it", () => {
    // Every rule must be wrapped in :where(). A bare selector would outrank a
    // single authored class and make the Platform dictate framing.
    const withoutComments = stylesheet.replaceAll(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...withoutComments.matchAll(/([^{}]+)\{/g)]
      .map(([, selector]) => selector?.trim() ?? "")
      .filter((selector) => selector.length > 0 && !selector.startsWith("@"));
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector).toMatch(/^:where\(/);
    }
  });

  it("resolves each viewport tier's focal point", () => {
    expect(stylesheet).toContain("--platform-media-position-desktop");
    expect(stylesheet).toContain("--platform-media-position-tablet");
    expect(stylesheet).toContain("--platform-media-position-mobile");
    expect(stylesheet).toMatch(/@media \(max-width: 63\.999rem\)/);
    expect(stylesheet).toMatch(/@media \(max-width: 47\.999rem\)/);
  });

  it("imposes no visual treatment", () => {
    // Safety mechanics only. Anything here would be the Platform authoring
    // aesthetics on the client's behalf.
    for (const property of [
      "aspect-ratio",
      "border-radius",
      "box-shadow",
      "filter",
      "background",
      "margin",
      "padding",
    ]) {
      expect(stylesheet).not.toContain(`${property}:`);
    }
  });
});
