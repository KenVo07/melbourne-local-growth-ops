import type { ResolvedDesign } from "../../decisions.js";
import { quote } from "../content.js";

/**
 * Emits the about route, the contact route and the not-found route.
 *
 * About either opens on the story with a portrait beside it, or opens on the
 * method — how the work is actually run is often the thing a customer is
 * deciding about, and leading with it is a different site, not a different
 * stylesheet. Contact either sets one panel beside the practical detail, or
 * states the direct channels first across the full measure and puts the form on
 * a reading column beneath.
 */
export function emitAboutContactRoutes(design: ResolvedDesign): string {
  const { ns, brief } = design;
  const arrive = design.interaction.reveals;
  const open = arrive ? "<Arrive>" : "<>";
  const close = arrive ? "</Arrive>" : "</>";
  const methodLed = brief.composition.about === "METHOD_LED";

  return `import {
  navigationHref,
  type ClientExperienceNotFoundProps,
  type ClientExperienceRouteProps,
} from "@proportion/client-experience";

import { RouteShell, Shell } from "../components/Shell";
import {
${arrive ? "  Arrive,\n" : ""}  Label,
  NextStep,
  PageHead,
  Plate,
  siteMedia,
} from "../components/Pieces";
import { COPY, SITE_MEDIA } from "../content/site-content";

/**
 * About — ${methodLed ? "method-led" : "story with a portrait"}.
 */
export function AboutRoute(props: ClientExperienceRouteProps) {
  const { page, platform, profile } = props;
  if (page.content.kind !== "PROFILE_SECTIONS") {
    throw new Error("About route requires PROFILE_SECTIONS page content.");
  }
  const wanted = new Set(page.content.sectionIds);
  const sections = profile.sections.filter((section) =>
    wanted.has(section.sectionId),
  );
  const story = sections.find((section) => section.type === "STORY");
  const method = sections.find((section) => section.type === "PROCESS");
  const trust = sections.find((section) => section.type === "TRUST_SIGNALS");

  return (
    <RouteShell props={props}>
      <PageHead
        label={COPY.aboutEyebrow}
        lede={COPY.aboutLede}
        title={story?.type === "STORY" ? story.heading : COPY.aboutEyebrow}
      />

${methodLed ? methodLedAbout(design) : proseWithPortrait(design)}

      ${open}
      {trust?.type !== "TRUST_SIGNALS" ? null : (
        <section
          aria-labelledby="${ns}-claims-heading"
          className="${ns}-shell ${ns}-claims-band"
        >
          <div className="${ns}-sticky">
            <Label>{COPY.claimsEyebrow}</Label>
            <h2
              className="${ns}-section-title"
              id="${ns}-claims-heading"
              style={{ marginTop: "var(--stack-tight)" }}
            >
              {trust.heading}
            </h2>
          </div>
          <div>
            <ul className="${ns}-claims">
              {trust.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {trust.disclaimer === undefined ? null : (
              <p
                className="${ns}-disclosure"
                style={{ marginTop: "var(--stack-loose)" }}
              >
                {trust.disclaimer}
              </p>
            )}
          </div>
        </section>
      )}
      ${close}

      <NextStep
        body={COPY.nextStepBody}
        heading={COPY.nextStepHeading}
        label={COPY.nextStepEyebrow}
        platform={platform}
        primary={COPY.homePrimaryAction}
        secondary={COPY.homeSecondaryAction}
      />
    </RouteShell>
  );
}

/**
 * Contact — ${brief.composition.contact === "STACKED_DIRECT" ? "direct channels first, form beneath" : "one panel beside the practical detail"}.
 *
 * The unconfigured channels are stated as fact rather than hidden, so the page
 * never implies someone is waiting to answer.
 */
export function ContactRoute(props: ClientExperienceRouteProps) {
  const { page, platform, profile } = props;
  if (page.content.kind !== "PROFILE_SECTIONS") {
    throw new Error("Contact route requires PROFILE_SECTIONS page content.");
  }
  const wanted = new Set(page.content.sectionIds);
  const sections = profile.sections.filter((section) =>
    wanted.has(section.sectionId),
  );
  const contact = sections.find((section) => section.type === "CONTACT");
  const actions = sections.flatMap((section) =>
    section.type === "ACTIONS" ? section.actions : [],
  );
  const faq = sections.find((section) => section.type === "FAQ");

  return (
    <RouteShell props={props}>
      <PageHead
        label={COPY.contactEyebrow}
        lede={contact?.type === "CONTACT" ? contact.body : undefined}
        title={COPY.contactHeading}
      />

${brief.composition.contact === "STACKED_DIRECT" ? stackedDirect(design) : panelSplit(design)}

      ${open}
      {faq?.type !== "FAQ" ? null : (
        <section
          aria-labelledby="${ns}-faq-heading"
          className="${ns}-shell ${ns}-faq-band"
        >
          <div className="${ns}-sticky">
            <Label>{COPY.faqEyebrow}</Label>
            <h2
              className="${ns}-section-title"
              id="${ns}-faq-heading"
              style={{ marginTop: "var(--stack-tight)" }}
            >
              {faq.heading}
            </h2>
          </div>
          <dl className="${ns}-faq">
            {faq.items.map((item) => (
              <div key={item.question}>
                <dt>{item.question}</dt>
                <dd>{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      ${close}
    </RouteShell>
  );
}

/**
 * Not found. Same chrome, same palette, and a route list rather than a dead end.
 * It is told nothing about the requested path, so a 404 cannot leak the route
 * table.
 */
export function NotFoundRoute({
  site,
  pageGraph,
  platform,
}: ClientExperienceNotFoundProps) {
  return (
    <Shell
      pageGraph={pageGraph}
      platform={platform}
      profile={{
        schemaVersion: 1,
        profile: ${quote(design.profile)},
        archetype: "SERVICE_LED",
        brand: {
          eyebrow: "",
          accentColor: ${quote(design.colour.inkMuted)},
          accentContrastColor: ${quote(design.colour.paper)},
          surfaceColor: ${quote(design.colour.ruleSoft)},
          textColor: ${quote(design.colour.inkMuted)},
        },
        sections: [],
      }}
      site={site}
    >
      <section className="${ns}-shell ${ns}-missing">
        <div>
          <Label>{COPY.notFoundLabel}</Label>
          <h1 className="${ns}-page-title">{COPY.notFoundHeading}</h1>
          <p className="${ns}-lede">{COPY.notFoundBody}</p>
        </div>
        <nav aria-label="Recovery navigation">
          {pageGraph.navigation.primary.map((item) => (
            <platform.Link
              href={navigationHref(pageGraph, item.target)}
              key={item.navigationId}
            >
              <span className="${ns}-onward">{item.label}</span>
            </platform.Link>
          ))}
        </nav>
      </section>
    </Shell>
  );
}
`;
}

function proseWithPortrait(design: ResolvedDesign): string {
  const { ns, breakpoints } = design;
  return `      <div className="${ns}-shell ${ns}-about-story">
        <div className="${ns}-prose">
          {story?.type === "STORY"
            ? story.body
                .split("\\n\\n")
                .map((paragraph) => <p key={paragraph}>{paragraph}</p>)
            : null}
        </div>
        <Plate
          platform={platform}
          ratio="tall"
          reference={siteMedia(SITE_MEDIA.about, "PORTRAIT")}
          sizes="(max-width: ${breakpoints.wide}) 100vw, 40vw"
        />
      </div>

      {method?.type !== "PROCESS" ? null : (
        <section
          aria-labelledby="${ns}-method-heading"
          className="${ns}-shell ${ns}-method"
        >
          <div className="${ns}-method-head">
            <Label>{COPY.methodEyebrow}</Label>
            <h2
              className="${ns}-section-title"
              id="${ns}-method-heading"
              style={{ marginTop: "var(--stack-tight)" }}
            >
              {method.heading}
            </h2>
          </div>
          <ol className="${ns}-steps">
            {method.items.map((item) => (
              <li key={item.title}>
                <div>
                  <p className="${ns}-step-title">{item.title}</p>
                  <p className="${ns}-step-body">{item.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}`;
}

function methodLedAbout(design: ResolvedDesign): string {
  const { ns, breakpoints } = design;
  return `      {method?.type !== "PROCESS" ? null : (
        <section
          aria-labelledby="${ns}-method-heading"
          className="${ns}-shell ${ns}-method"
        >
          <div className="${ns}-method-head">
            <div>
              <Label>{COPY.methodEyebrow}</Label>
              <h2
                className="${ns}-section-title"
                id="${ns}-method-heading"
                style={{ marginTop: "var(--stack-tight)" }}
              >
                {method.heading}
              </h2>
            </div>
            <p className="${ns}-lede">{COPY.methodLede}</p>
          </div>
          <ol className="${ns}-steps">
            {method.items.map((item) => (
              <li key={item.title}>
                <div>
                  <p className="${ns}-step-title">{item.title}</p>
                  <p className="${ns}-step-body">{item.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="${ns}-shell ${ns}-about-story">
        <Plate
          platform={platform}
          ratio="tall"
          reference={siteMedia(SITE_MEDIA.about, "PORTRAIT")}
          sizes="(max-width: ${breakpoints.wide}) 100vw, 42vw"
        />
        <div className="${ns}-prose">
          {story?.type === "STORY"
            ? story.body
                .split("\\n\\n")
                .map((paragraph) => <p key={paragraph}>{paragraph}</p>)
            : null}
        </div>
      </div>`;
}

function panelSplit(design: ResolvedDesign): string {
  const { ns } = design;
  return `      <div className="${ns}-shell ${ns}-contact">
        <div>
          <div>
            <Label>{COPY.checklistEyebrow}</Label>
            <ul className="${ns}-checklist" style={{ marginTop: "var(--stack)" }}>
              {COPY.contactChecklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div style={{ display: "grid", gap: "var(--stack)" }}>
            <Label>{COPY.channelsEyebrow}</Label>
            {actions.map((action) => (
              <div className="${ns}-notice" key={action.actionId}>
                <platform.Action actionId={action.actionId} />
              </div>
            ))}
          </div>
        </div>

        <div className="${ns}-panel">
          <platform.Region regionId="primary" />
        </div>
      </div>`;
}

function stackedDirect(design: ResolvedDesign): string {
  const { ns } = design;
  return `      <div className="${ns}-shell">
        <section aria-label={COPY.channelsEyebrow} className="${ns}-channels">
          {actions.map((action) => (
            <div className="${ns}-notice" key={action.actionId}>
              <platform.Action actionId={action.actionId} />
            </div>
          ))}
        </section>

        <div className="${ns}-contact-form">
          <div>
            <Label>{COPY.checklistEyebrow}</Label>
            <ul className="${ns}-checklist">
              {COPY.contactChecklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <platform.Region regionId="primary" />
          </div>
        </div>
      </div>`;
}
