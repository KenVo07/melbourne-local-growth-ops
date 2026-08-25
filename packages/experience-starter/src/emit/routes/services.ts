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
  type RuntimeServiceItem,
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
  const sections = profile.sections.filter(
    (section) => section.type === "SERVICES",
  );
  const services = sections.flatMap((section) => section.items);
  const groups = sections.flatMap((section) => section.groups);
  /*
   * A business with a handful of peer services declares no groups and gets one
   * unheaded run — the flat list it already had. A business that groups its
   * work gets a real heading level per group, because eleven peers presented
   * flat is an information-architecture failure no layout repairs.
   */
  const runs =
    groups.length === 0
      ? [{ key: "all", title: undefined, description: undefined, services }]
      : [
          ...groups.map((group) => ({
            key: group.groupId,
            title: group.title,
            description: group.description,
            services: services.filter((item) => item.groupId === group.groupId),
          })),
          ...(services.some((item) => item.groupId === undefined)
            ? [
                {
                  key: "ungrouped",
                  title: "Also available",
                  description: undefined,
                  services: services.filter((item) => item.groupId === undefined),
                },
              ]
            : []),
        ];

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
  /*
   * The definition is the business-truth authority, so its narrative wins. The
   * brief entry is editorial for a service whose definition has none.
   */
  const body = service.narrative ?? narrative?.body;
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

/**
 * The questions a customer actually arrives with.
 *
 * Answered pairs from the client definition come first, because a question with
 * the business's own answer beside it is worth more than the question alone.
 * Unanswered prompts from the brief follow, and either list may be empty.
 */
function QuestionRail({
  answered,
  narrative,
  platform,
}: {
  readonly answered: readonly { readonly question: string; readonly answer: string }[];
  readonly narrative: { readonly questions: readonly string[] } | undefined;
  readonly platform: ClientExperienceRouteProps["platform"];
}) {
  const prompts = narrative?.questions ?? [];
  return (
    <>
      {answered.length === 0 ? null : (
        <div>
          <Label>{COPY.questionsEyebrow}</Label>
          <dl className="${ns}-answered" style={{ marginTop: "var(--stack)" }}>
            {answered.map((entry) => (
              <div key={entry.question}>
                <dt>{entry.question}</dt>
                <dd>{entry.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {prompts.length === 0 ? null : (
        <div>
          {answered.length > 0 ? null : <Label>{COPY.questionsEyebrow}</Label>}
          <ul className="${ns}-questions" style={{ marginTop: "var(--stack)" }}>
            {prompts.map((question) => (
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

/**
 * What the service covers, where it stops, and what the customer has to do.
 *
 * Every panel renders only if the client definition carries truth for it, so a
 * business that has answered four of these questions shows four panels rather
 * than nine headings over "not stated". Nothing here invents a boundary, a
 * price or a stage.
 */
function Decision({
  service,
}: {
  readonly service: RuntimeServiceItem;
}) {
  const decision = service.decision;
  if (decision === undefined) return null;
  const lists: readonly (readonly [string, readonly string[]])[] = [
    ["Best suited to", decision.suitedTo],
    ["What this covers", decision.covers],
    ["What this does not cover", decision.excludes],
    ["When to call us", decision.whenToCall],
    ["What we need from you", decision.customerProvides],
  ];
  const shown = lists.filter(([, items]) => items.length > 0);
  if (
    shown.length === 0 &&
    decision.stages.length === 0 &&
    decision.commercial.length === 0
  ) {
    return null;
  }

  return (
    <div className="${ns}-decision">
      {shown.map(([heading, items]) => (
        <section key={heading}>
          <h2 className="${ns}-decision-heading">{heading}</h2>
          <ul>
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}

      {decision.stages.length === 0 ? null : (
        <section>
          <h2 className="${ns}-decision-heading">How the job runs</h2>
          <ol className="${ns}-stages">
            {decision.stages.map((stage) => (
              <li key={stage.title}>
                <strong>{stage.title}</strong>
                <span>{stage.description}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {decision.commercial.length === 0 ? null : (
        <section>
          <h2 className="${ns}-decision-heading">What is known about cost</h2>
          <dl className="${ns}-answered">
            {decision.commercial.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>
                  {fact.value}
                  {fact.qualifier === undefined ? null : (
                    <span className="${ns}-meta"> — {fact.qualifier}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
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
  return `      {runs.map((run) => (
      <div className="${ns}-shell" key={run.key}>
        {run.title === undefined ? null : (
          <div className="${ns}-service-group">
            <h2 className="${ns}-group-title">{run.title}</h2>
            {run.description === undefined ? null : <p>{run.description}</p>}
          </div>
        )}
        {run.services.map((service, index) => {
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
                {narrative?.photograph === undefined ? null : (
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
      </div>
      ))}`;
}

function staggeredColumns(design: ResolvedDesign): string {
  const { ns, breakpoints } = design;
  return `      {runs.map((run) => (
      <div key={run.key}>
        {run.title === undefined ? null : (
          <div className="${ns}-shell ${ns}-service-group">
            <h2 className="${ns}-group-title">{run.title}</h2>
            {run.description === undefined ? null : <p>{run.description}</p>}
          </div>
        )}
      <div className="${ns}-shell ${ns}-service-grid">
        {run.services.map((service, index) => {
          const narrative =
            service.serviceId === undefined
              ? undefined
              : SERVICE_NARRATIVE[service.serviceId];
          return (
            <article
              className="${ns}-service-card"
              key={service.serviceId ?? service.title}
            >
              {narrative?.photograph === undefined ? null : (
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
      </div>
      </div>
      ))}`;
}

function readingColumnRail(design: ResolvedDesign): string {
  const { ns, breakpoints } = design;
  return `      <div className="${ns}-shell ${ns}-detail" data-service-id={serviceId}>
        <div className="${ns}-detail-main">
          {narrative?.photograph === undefined ? null : (
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
          {body === undefined ? null : (
            <div className="${ns}-prose">
              <p>{body}</p>
            </div>
          )}
          <Decision service={service} />
          <Evidence evidence={evidence} platform={platform} />
        </div>

        <aside className="${ns}-detail-aside">
          <QuestionRail
            answered={service.decision?.questions ?? []}
            narrative={narrative}
            platform={platform}
          />
        </aside>
      </div>`;
}

function mediaInterrupt(design: ResolvedDesign): string {
  const { ns } = design;
  return `      {narrative?.photograph === undefined ? null : (
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
          {body === undefined ? null : (
            <div className="${ns}-prose">
              <p>{body}</p>
            </div>
          )}
          <Decision service={service} />
          <Evidence evidence={evidence} platform={platform} />
        </div>

        <aside className="${ns}-detail-aside">
          <QuestionRail
            answered={service.decision?.questions ?? []}
            narrative={narrative}
            platform={platform}
          />
        </aside>
      </div>`;
}
