import type { ResolvedDesign } from "../../decisions.js";
import { quote } from "../content.js";

/**
 * Emits the home route.
 *
 * Two openings are available and exactly one is written. They are not one layout
 * behind a flag: a split statement puts the proposition beside the photograph so
 * nothing that matters is pushed below a media hero, while an image-led opening
 * gives the first screen to the photograph and sets the proposition beneath it
 * on an offset column, then states the method as a compact band of facts. The
 * rest of the page — the service register and the project preview — is shared,
 * because a home page that changes everything at once has no spine.
 */
export function emitHomeRoute(design: ResolvedDesign): string {
  const { ns, brief } = design;
  const arrive = brief.motion === "ENTRANCE";
  const open = arrive ? "<Arrive>" : "<>";
  const close = arrive ? "</Arrive>" : "</>";
  const imageLedOpening = brief.composition.home === "IMAGE_LED";

  return `import {
  serviceById,
  type ClientExperienceRouteProps,
} from "@proportion/client-experience";

import { RouteShell } from "../components/Shell";
import {
${arrive ? "  Arrive,\n" : ""}  Label,
  Plate,
  siteMedia,
} from "../components/Pieces";
import { COPY, SITE_MEDIA } from "../content/site-content";

/**
 * Home — ${imageLedOpening ? "image-led opening" : "split-statement opening"}.
 */
export function HomeRoute(props: ClientExperienceRouteProps) {
  const { platform, profile, projects } = props;
  const services = profile.sections.flatMap((section) =>
    section.type === "SERVICES" ? section.items : [],
  );
${imageLedOpening ? "  const method = profile.sections.find((section) => section.type === \"PROCESS\");\n" : ""}
  return (
    <RouteShell props={props}>
${imageLedOpening ? imageLed(design) : splitStatement(design)}

      ${open}
      <section
        aria-labelledby="${ns}-services-heading"
        className="${ns}-shell ${ns}-register"
      >
        <div className="${ns}-register-head">
          <div>
            <Label>{COPY.servicesEyebrow}</Label>
            <h2
              className="${ns}-section-title"
              id="${ns}-services-heading"
              style={{ marginTop: "var(--stack-tight)" }}
            >
              {COPY.homeServicesHeading}
            </h2>
          </div>
          <p className="${ns}-lede">{COPY.servicesLede}</p>
        </div>

        <ul>
          {services.map((service, index) => (
            <li key={service.serviceId ?? service.title}>
              {service.serviceId === undefined ? null : (
                <platform.Link href={\`/services/\${service.serviceId}\`}>
                  <span className="${ns}-row">
                    <span className="${ns}-row-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="${ns}-row-title">{service.title}</span>
                    <span className="${ns}-row-text">{service.description}</span>
                  </span>
                </platform.Link>
              )}
            </li>
          ))}
        </ul>
      </section>
      ${close}

      ${open}
      <section
        aria-labelledby="${ns}-work-heading"
        className="${ns}-shell ${ns}-preview"
      >
        <div>
          <Label>{COPY.projectsEyebrow}</Label>
          <h2
            className="${ns}-section-title"
            id="${ns}-work-heading"
            style={{ marginTop: "var(--stack-tight)" }}
          >
            {COPY.homeProjectsHeading}
          </h2>
        </div>
        <div className="${ns}-preview-aside">
          <ul>
            {projects.projects.map((project, index) => (
              <li key={project.projectId}>
                <platform.Link href={\`/projects/\${project.slug}\`}>
                  <span className="${ns}-row-compact">
                    <span className="${ns}-row-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="${ns}-row-title">{project.title}</span>
                    <span className="${ns}-meta">
                      {project.serviceIds
                        .map(
                          (serviceId) =>
                            serviceById(profile, serviceId)?.title ?? serviceId,
                        )
                        .slice(0, 1)
                        .join("")}
                    </span>
                  </span>
                </platform.Link>
              </li>
            ))}
          </ul>
          <p style={{ marginTop: "var(--stack-loose)" }}>
            <platform.Link href="/projects">
              <span className="${ns}-onward">{COPY.homeSecondaryAction}</span>
            </platform.Link>
          </p>
        </div>
      </section>
      ${close}
    </RouteShell>
  );
}
`;
}

/** The proposition beside the photograph. */
function splitStatement(design: ResolvedDesign): string {
  const { ns, brief } = design;
  const band =
    brief.mediaPlan.homeSecondary === undefined
      ? ""
      : `

      <section className="${ns}-shell ${ns}-band">
        <Plate
          platform={platform}
          ratio="panorama"
          reference={siteMedia(SITE_MEDIA.homeSecondary)}
          sizes="100vw"
        />
      </section>`;
  return `      <section className="${ns}-shell ${ns}-hero">
        <div className="${ns}-hero-copy">
          <Label>{COPY.homeEyebrow}</Label>
          <h1 className="${ns}-display">${headline(design)}</h1>
          <p className="${ns}-lede">{COPY.homeLede}</p>
          <div className="${ns}-hero-actions">
            <platform.Link href="/contact">
              <span className="${ns}-action">{COPY.homePrimaryAction}</span>
            </platform.Link>
            <platform.Link href="/projects">
              <span className="${ns}-onward">{COPY.homeSecondaryAction}</span>
            </platform.Link>
          </div>
        </div>

        <div className="${ns}-hero-media">
          <Plate
            platform={platform}
            priority
            ratio="tall"
            reference={siteMedia(SITE_MEDIA.homeHero, "HERO")}
            sizes="(max-width: ${design.breakpoints.wide}) 100vw, 42vw"
          />
        </div>
      </section>${band}`;
}

/** The photograph first, the proposition beneath it on an offset column. */
function imageLed(design: ResolvedDesign): string {
  const { ns } = design;
  return `      <section className="${ns}-shell ${ns}-cover">
        <div className="${ns}-cover-media">
          <Plate
            platform={platform}
            priority
            ratio="panorama"
            reference={siteMedia(SITE_MEDIA.homeHero, "HERO")}
            sizes="100vw"
          />
        </div>
      </section>

      <section className="${ns}-shell ${ns}-cover-copy">
        <div>
          <Label>{COPY.homeEyebrow}</Label>
          <h1 className="${ns}-display">${headline(design)}</h1>
        </div>
        <div className="${ns}-cover-aside">
          <p className="${ns}-lede">{COPY.homeLede}</p>
          <div className="${ns}-actions">
            <platform.Link href="/contact">
              <span className="${ns}-action">{COPY.homePrimaryAction}</span>
            </platform.Link>
            <platform.Link href="/projects">
              <span className="${ns}-onward">{COPY.homeSecondaryAction}</span>
            </platform.Link>
          </div>
        </div>
      </section>

      {/* One dense moment between two open ones: the method stated as facts. */}
      {method === undefined || method.type !== "PROCESS" ? null : (
        <section className="${ns}-shell ${ns}-proof">
          {method.items.slice(0, 3).map((item) => (
            <div key={item.title}>
              <p className="${ns}-proof-value">{item.title}</p>
              <p className="${ns}-meta">{item.description}</p>
            </div>
          ))}
        </section>
      )}`;
}

/**
 * The headline, with its operative phrase carrying the emphasis treatment the
 * brief chose. Split at generation time so the emitted source is literal JSX an
 * operator can rewrite, not a runtime string search.
 */
function headline(design: ResolvedDesign): string {
  const { ns, brief } = design;
  const { homeHeadline, homeHeadlineEmphasis } = brief.copy;
  if (
    homeHeadlineEmphasis === undefined ||
    !homeHeadline.includes(homeHeadlineEmphasis)
  ) {
    return `\n            {${quote(homeHeadline)}}\n          `;
  }
  const at = homeHeadline.indexOf(homeHeadlineEmphasis);
  const before = homeHeadline.slice(0, at);
  const after = homeHeadline.slice(at + homeHeadlineEmphasis.length);
  return `
            ${before.length === 0 ? "" : `{${quote(before)}}`}
            <em className="${ns}-emphasis">{${quote(homeHeadlineEmphasis)}}</em>
            ${after.length === 0 ? "" : `{${quote(after)}}`}
          `;
}
