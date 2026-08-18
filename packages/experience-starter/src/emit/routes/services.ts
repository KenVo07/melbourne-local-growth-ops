import type { ResolvedDesign } from "../../decisions.js";
import type { InteractionPlan } from "../../interaction-decisions.js";
import { reveal, usesArrive } from "./reveal.js";

/**
 * Emits the services index and the service detail routes.
 *
 * The index either alternates full-measure entries (the plate side flipping each
 * row) or stages three columns at different depths with the photograph above the
 * title. The detail route either sets the argument beside a rail of the
 * customer's own questions, or lets one full-width photograph interrupt the page
 * before the practical detail resumes. Which pair is written is a design
 * decision; both are ordinary source once written.
 */
export function emitServicesRoutes(
  design: ResolvedDesign,
  plan: InteractionPlan,
): string {
  const { ns, brief } = design;
  /*
   * The register of services is the whole of this page's argument, so it is the
   * one thing that arrives even for a client that reveals only key moments.
   */
  const register = reveal(plan, "ARGUMENT");
  const arrive = usesArrive(plan, ["ARGUMENT"]);
  /*
   * Only the bindings the chosen grammar actually reads. The artifact compiles
   * with noUnusedLocals, so an unread destructure would fail the client's own
   * typecheck — the generator must not hand anyone dead code.
   */
  const DETAIL_BINDINGS =
    brief.composition.serviceDetail === "MEDIA_INTERRUPT"
      ? "page, platform, profile, projects"
      : "media, page, platform, profile, projects";

  return `import {
  serviceById,
  type ClientExperienceRouteProps,
  type RuntimeProject,
} from "@proportion/client-experience";

import { RouteShell } from "../components/Shell";
import {
${arrive ? "  Arrive,\n" : ""}  Label,
  NextStep,
  PageHead,
  Plate,
  ratioFor,
  siteMedia,
} from "../components/Pieces";
import { COPY, SERVICE_NARRATIVE } from "../content/site-content";

/**
 * Services index — ${brief.composition.servicesIndex === "STAGGERED_COLUMNS" ? "staggered columns" : "alternating full-measure rows"}.
 */
export function ServicesIndexRoute(props: ClientExperienceRouteProps) {
  const { media, platform, profile } = props;
  const services = profile.sections.flatMap((section) =>
    section.type === "SERVICES" ? section.items : [],
  );

  return (
    <RouteShell props={props}>
      <PageHead
        label={COPY.servicesEyebrow}
        lede={COPY.servicesLede}
        title={COPY.homeServicesHeading}
      />

      ${register.open}
${brief.composition.servicesIndex === "STAGGERED_COLUMNS" ? staggeredColumns(design) : alternatingRows(design)}
      ${register.close}

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
 * Service detail — ${brief.composition.serviceDetail === "MEDIA_INTERRUPT" ? "full-width media interruption" : "reading column with a question rail"}.
 */
export function ServiceDetailRoute(props: ClientExperienceRouteProps) {
  const { ${DETAIL_BINDINGS} } = props;
  if (page.content.kind !== "SERVICE") {
    throw new Error("Service detail route requires SERVICE page content.");
  }
  const serviceId = page.content.serviceId;
  const service = serviceById(profile, serviceId);
  if (service === undefined) {
    throw new Error(\`Service "\${serviceId}" is not declared by the profile.\`);
  }
  const narrative = SERVICE_NARRATIVE[serviceId];
  const evidence = projects.projects.filter((project) =>
    project.serviceIds.includes(serviceId),
  );

  return (
    <RouteShell props={props}>
      <PageHead
        label={service.title}
        lede={service.description}
        title={service.title}
      />

${brief.composition.serviceDetail === "MEDIA_INTERRUPT" ? mediaInterrupt(design) : readingColumnRail(design)}
    </RouteShell>
  );
}

/** The questions a customer actually arrives with, and the honest limit. */
function QuestionRail({
  narrative,
  platform,
}: {
  readonly narrative: { readonly questions: readonly string[] } | undefined;
  readonly platform: ClientExperienceRouteProps["platform"];
}) {
  return (
    <>
      {narrative === undefined ? null : (
        <div>
          <Label>{COPY.questionsEyebrow}</Label>
          <ul className="${ns}-questions" style={{ marginTop: "var(--stack)" }}>
            {narrative.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="${ns}-callout">
        <Label>{COPY.nextStepEyebrow}</Label>
        <p>{COPY.nextStepBody}</p>
        <p>
          <platform.Link href="/contact">
            <span className="${ns}-onward">{COPY.homePrimaryAction}</span>
          </platform.Link>
        </p>
      </div>
    </>
  );
}

/** Where a service has already appeared in the record set. */
function Evidence({
  evidence,
  platform,
}: {
  readonly evidence: readonly RuntimeProject[];
  readonly platform: ClientExperienceRouteProps["platform"];
}) {
  if (evidence.length === 0) return null;
  return (
    <div>
      <Label>{COPY.evidenceEyebrow}</Label>
      <ul style={{ marginTop: "var(--stack)" }}>
        {evidence.map((project) => (
          <li key={project.projectId}>
            <platform.Link href={\`/projects/\${project.slug}\`}>
              <span className="${ns}-row-compact" data-columns="two">
                <span className="${ns}-row-title">{project.title}</span>
                <span className="${ns}-meta">{project.locationLabel ?? ""}</span>
              </span>
            </platform.Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
`;
}

function alternatingRows(design: ResolvedDesign): string {
  const { ns, breakpoints } = design;
  return `      <div className="${ns}-shell">
        {services.map((service, index) => {
          const narrative =
            service.serviceId === undefined
              ? undefined
              : SERVICE_NARRATIVE[service.serviceId];
          return (
            <article
              className="${ns}-service-row"
              data-flip={index % 2 === 1 ? "true" : "false"}
              key={service.serviceId ?? service.title}
            >
              <div>
                <Label>{String(index + 1).padStart(2, "0")}</Label>
                <h2 className="${ns}-item-title">{service.title}</h2>
                <p className="${ns}-service-text">{service.description}</p>
                {service.serviceId === undefined ? null : (
                  <p>
                    <platform.Link href={\`/services/\${service.serviceId}\`}>
                      <span className="${ns}-onward">{COPY.serviceMoreLabel}</span>
                    </platform.Link>
                  </p>
                )}
              </div>
              <div className="${ns}-service-media">
                {narrative === undefined ? null : (
                  <Plate
                    platform={platform}
                    ratio={ratioFor(media, narrative.photograph.assetId, {
                      portrait: "tall",
                      landscape: "wide",
                    })}
                    reference={siteMedia(narrative.photograph)}
                    sizes="(max-width: ${breakpoints.wide}) 100vw, 44vw"
                  />
                )}
              </div>
            </article>
          );
        })}
      </div>`;
}

function staggeredColumns(design: ResolvedDesign): string {
  const { ns, breakpoints } = design;
  return `      <div className="${ns}-shell ${ns}-service-grid">
        {services.map((service, index) => {
          const narrative =
            service.serviceId === undefined
              ? undefined
              : SERVICE_NARRATIVE[service.serviceId];
          return (
            <article
              className="${ns}-service-card"
              key={service.serviceId ?? service.title}
            >
              {narrative === undefined ? null : (
                <Plate
                  platform={platform}
                  ratio={ratioFor(media, narrative.photograph.assetId, {
                    portrait: "tall",
                    landscape: "wide",
                  })}
                  reference={siteMedia(narrative.photograph)}
                  sizes="(max-width: ${breakpoints.wide}) 100vw, 30vw"
                />
              )}
              <Label>{String(index + 1).padStart(2, "0")}</Label>
              <h2 className="${ns}-item-title">{service.title}</h2>
              <p className="${ns}-service-text">{service.description}</p>
              {service.serviceId === undefined ? null : (
                <p>
                  <platform.Link href={\`/services/\${service.serviceId}\`}>
                    <span className="${ns}-onward">{COPY.serviceMoreLabel}</span>
                  </platform.Link>
                </p>
              )}
            </article>
          );
        })}
      </div>`;
}

function readingColumnRail(design: ResolvedDesign): string {
  const { ns, breakpoints } = design;
  return `      <div className="${ns}-shell ${ns}-detail" data-service-id={serviceId}>
        <div className="${ns}-detail-main">
          {narrative === undefined ? null : (
            <Plate
              platform={platform}
              ratio={ratioFor(media, narrative.photograph.assetId, {
                portrait: "wide",
                landscape: "wide",
              })}
              reference={siteMedia(narrative.photograph)}
              sizes="(max-width: ${breakpoints.wide}) 100vw, 58vw"
            />
          )}
          {narrative === undefined ? null : (
            <div className="${ns}-prose">
              <p>{narrative.body}</p>
            </div>
          )}
          <Evidence evidence={evidence} platform={platform} />
        </div>

        <aside className="${ns}-detail-aside">
          <QuestionRail narrative={narrative} platform={platform} />
        </aside>
      </div>`;
}

function mediaInterrupt(design: ResolvedDesign): string {
  const { ns } = design;
  return `      {narrative === undefined ? null : (
        <div className="${ns}-shell ${ns}-interrupt">
          <Plate
            platform={platform}
            priority
            ratio="panorama"
            reference={siteMedia(narrative.photograph)}
            sizes="100vw"
          />
        </div>
      )}

      <div className="${ns}-shell ${ns}-detail-split" data-service-id={serviceId}>
        <div>
          {narrative === undefined ? null : (
            <div className="${ns}-prose">
              <p>{narrative.body}</p>
            </div>
          )}
          <Evidence evidence={evidence} platform={platform} />
        </div>

        <aside className="${ns}-detail-aside">
          <QuestionRail narrative={narrative} platform={platform} />
        </aside>
      </div>`;
}
