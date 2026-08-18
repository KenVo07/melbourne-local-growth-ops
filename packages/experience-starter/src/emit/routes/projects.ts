import type { ResolvedDesign } from "../../decisions.js";
import type { InteractionPlan } from "../../interaction-decisions.js";

/**
 * Emits the projects index and the project detail routes.
 *
 * The index either reads as wide editorial records with the meta beside the
 * plate, or as a staggered numbered index where every second entry steps in and
 * to the side. The detail route either reads as a document — hero, disclosure,
 * facts band, then the story — or as staggered beats where the photograph and
 * the copy trade sides down the page and the facts land mid-narrative.
 */
export function emitProjectsRoutes(
  design: ResolvedDesign,
  plan: InteractionPlan,
): string {
  const { ns, brief } = design;
  const arrive = design.interaction.reveals;
  const open = arrive ? "<Arrive>" : "<>";
  const close = arrive ? "</Arrive>" : "</>";

  return `import {
  relatedProjects,
  serviceById,
  siblingProjects,
  type ClientExperienceRouteProps,
} from "@proportion/client-experience";

${plan.usesMediaExplorer ? 'import { Explore, MediaExplorer } from "../components/MediaViewer";\n' : ""}import { RouteShell } from "../components/Shell";
import {
${arrive ? "  Arrive,\n" : ""}  Label,
  NextStep,
  PageHead,
  Plate,
  ratioFor,
} from "../components/Pieces";
import { COPY } from "../content/site-content";

/**
 * Projects index — ${brief.composition.projectsIndex === "STAGGERED_INDEX" ? "staggered numbered index" : "wide editorial records"}.
 */
export function ProjectsIndexRoute(props: ClientExperienceRouteProps) {
  const { media, platform, profile, projects } = props;

  return (
    <RouteShell props={props}>
      <PageHead
        label={COPY.projectsEyebrow}
        lede={COPY.projectsLede}
        title={COPY.homeProjectsHeading}
      />

      ${open}
${brief.composition.projectsIndex === "STAGGERED_INDEX" ? staggeredIndex(design) : editorialRecords(design)}
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
 * Project detail — ${brief.composition.projectDetail === "STAGGERED_BEATS" ? "staggered beats" : "document"}.
 */
export function ProjectDetailRoute(props: ClientExperienceRouteProps) {
  const { media, platform, profile, project, projects } = props;
  if (project === undefined) {
    throw new Error("Project detail route requires a resolved project.");
  }
  const related = relatedProjects(projects, project);
  const { previous, next } = siblingProjects(projects, project);
  const onward: readonly {
    project: NonNullable<typeof next>;
    relation: string;
  }[] =
    related.length > 0
      ? related.map((candidate) => ({
          project: candidate,
          relation: COPY.relatedRecordLabel,
        }))
      : [
          ...(next === undefined
            ? []
            : [{ project: next, relation: COPY.relatedRecordLabel }]),
          ...(previous === undefined
            ? []
            : [{ project: previous, relation: COPY.relatedRecordLabel }]),
        ];
${
  plan.usesMediaExplorer
    ? `
  /*
   * Every photograph this project carries, in the order a reader meets them:
   * the hero, then each story beat's media. The overlay steps through this
   * sequence, so "next" means the next photograph of the project rather than
   * the next one in some beat.
   */
  const exploreOrder = [
    project.hero,
    ...project.story.flatMap((block) => block.media),
  ];
  const exploreIndex = (reference: (typeof exploreOrder)[number]) =>
    exploreOrder.indexOf(reference);
  const exploreItems = exploreOrder.map((reference) => ({
    id: reference.assetId,
    caption: reference.caption ?? reference.alt,
    full: (
      <platform.Image
        reference={reference}
        sizes="(max-width: 60rem) 92vw, 72rem"
      />
    ),
  }));
`
    : ""
}
  return (
    <RouteShell props={props}>
      <PageHead
        aside={
          project.truthMode === "DEMONSTRATION" &&
          project.demonstrationDisclosure !== undefined ? (
            <p
              className="${ns}-disclosure"
              data-disclosure="demonstration"
              role="note"
            >
              {project.demonstrationDisclosure}
            </p>
          ) : undefined
        }
        label={project.locationLabel ?? COPY.projectsEyebrow}
        lede={project.summary}
        title={project.title}
      />

${
  plan.usesMediaExplorer
    ? `      <MediaExplorer
        items={exploreItems}
        label={\`\${project.title} — photographs\`}
        openLabel="Open photograph"
      >
${indent(brief.composition.projectDetail === "STAGGERED_BEATS" ? staggeredBeats(design, plan) : documentRecord(design, plan))}
      </MediaExplorer>`
    : brief.composition.projectDetail === "STAGGERED_BEATS"
      ? staggeredBeats(design, plan)
      : documentRecord(design, plan)
}

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
`;
}

function editorialRecords(design: ResolvedDesign): string {
  const { ns, breakpoints } = design;
  return `      <div className="${ns}-shell">
        {projects.projects.map((project, index) => (
          <platform.Link href={\`/projects/\${project.slug}\`} key={project.projectId}>
            <article
              className="${ns}-record"
              data-flip={index % 2 === 1 ? "true" : "false"}
            >
              <div className="${ns}-record-media">
                <Plate
                  platform={platform}
                  priority={index === 0}
                  ratio={ratioFor(media, project.hero.assetId, {
                    portrait: "tall",
                    landscape: "wide",
                  })}
                  reference={project.hero}
                  sizes="(max-width: ${breakpoints.wide}) 100vw, 56vw"
                />
              </div>
              <div className="${ns}-record-meta">
                <Label>
                  {String(index + 1).padStart(2, "0")}
                  {project.locationLabel === undefined
                    ? ""
                    : \` · \${project.locationLabel}\`}
                </Label>
                <h2 className="${ns}-record-title">{project.title}</h2>
                <p className="${ns}-record-summary">{project.summary}</p>
                <p className="${ns}-meta">
                  {project.serviceIds
                    .map(
                      (serviceId) =>
                        serviceById(profile, serviceId)?.title ?? serviceId,
                    )
                    .join(" · ")}
                </p>
              </div>
            </article>
          </platform.Link>
        ))}
      </div>`;
}

function staggeredIndex(design: ResolvedDesign): string {
  const { ns, breakpoints } = design;
  return `      <div className="${ns}-shell ${ns}-index-list">
        {projects.projects.map((project, index) => {
          const offset = index % 2 === 1;
          return (
            <article
              className="${ns}-index-entry"
              data-align={index % 4 === 1 ? "end" : "start"}
              data-width={offset ? "offset" : "full"}
              key={project.projectId}
            >
              <platform.Link href={\`/projects/\${project.slug}\`}>
                <div className="${ns}-index-entry-meta">
                  <div>
                    <Label>
                      {String(index + 1).padStart(2, "0")}
                      {project.locationLabel === undefined
                        ? ""
                        : \` · \${project.locationLabel}\`}
                    </Label>
                    <h2
                      className="${ns}-record-title"
                      style={{ marginTop: "var(--stack-tight)" }}
                    >
                      {project.title}
                    </h2>
                  </div>
                  <div>
                    <p className="${ns}-record-summary">{project.summary}</p>
                    <p className="${ns}-meta" style={{ marginTop: "var(--stack-tight)" }}>
                      {project.serviceIds
                        .map(
                          (serviceId) =>
                            serviceById(profile, serviceId)?.title ?? serviceId,
                        )
                        .join(" · ")}
                    </p>
                  </div>
                </div>
                <Plate
                  platform={platform}
                  priority={index === 0}
                  ratio={ratioFor(media, project.hero.assetId, {
                    portrait: "tall",
                    landscape: "wide",
                  })}
                  reference={project.hero}
                  sizes={
                    offset
                      ? "(max-width: ${breakpoints.wide}) 100vw, 56vw"
                      : "(max-width: ${breakpoints.wide}) 100vw, 78vw"
                  }
                />
              </platform.Link>
            </article>
          );
        })}
      </div>`;
}

/** Facts and onward navigation, shared by both detail grammars. */
function factsAndOnward(design: ResolvedDesign): string {
  const { ns } = design;
  return `        <dl className="${ns}-facts">
          {project.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>`;
}

function onwardNav(design: ResolvedDesign): string {
  const { ns } = design;
  return `        {onward.length === 0 ? null : (
          <nav aria-label="Other records" className="${ns}-onward-grid">
            {onward.map(({ project: candidate, relation }) => (
              <platform.Link
                href={\`/projects/\${candidate.slug}\`}
                key={candidate.projectId}
              >
                <span>
                  <span className="${ns}-label">{relation}</span>
                  <span
                    className="${ns}-item-title"
                    style={{ display: "block", marginTop: "var(--stack-tight)" }}
                  >
                    {candidate.title}
                  </span>
                  <span
                    className="${ns}-meta"
                    style={{ display: "block", marginTop: "var(--stack-tight)" }}
                  >
                    {candidate.serviceIds
                      .map(
                        (serviceId) =>
                          serviceById(profile, serviceId)?.title ?? serviceId,
                      )
                      .join(" · ")}
                  </span>
                </span>
              </platform.Link>
            ))}
          </nav>
        )}`;
}

function documentRecord(design: ResolvedDesign, plan: InteractionPlan): string {
  const { ns, breakpoints } = design;
  return `      <div className="${ns}-shell">
        <div className="${ns}-hero-record">
          ${explorable(
            plan,
            "0",
            null,
            `<Plate
            platform={platform}
            priority
            ratio={ratioFor(media, project.hero.assetId, {
              portrait: "wide",
              landscape: "panorama",
            })}
            reference={project.hero}
            sizes="100vw"
          />`,
            "          ",
          )}
        </div>

${factsAndOnward(design)}

        {project.story.map((block, index) => (
          <section className="${ns}-beat" key={block.blockId}>
            <div>
              <p className="${ns}-beat-index">
                {String(index + 1).padStart(2, "0")}
              </p>
            </div>
            <div className="${ns}-beat-copy">
              <h2 className="${ns}-item-title">{block.heading}</h2>
              <p className="${ns}-beat-body">{block.body}</p>
              {block.media.length === 0 ? null : (
                <div className="${ns}-beat-media">
                  {block.media.map((reference) => (
                    ${explorable(
                      plan,
                      "exploreIndex(reference)",
                      "reference.assetId",
                      `<Plate
                        platform={platform}
                        ratio={ratioFor(media, reference.assetId, {
                          portrait: "tall",
                          landscape: "wide",
                        })}
                        reference={reference}
                        sizes="(max-width: ${breakpoints.wide}) 100vw, 62vw"
                      />`,
                      "                    ",
                    )}
                  ))}
                </div>
              )}
            </div>
          </section>
        ))}

${onwardNav(design)}
      </div>`;
}

function staggeredBeats(design: ResolvedDesign, plan: InteractionPlan): string {
  const { ns, breakpoints } = design;
  return `      <div className="${ns}-shell">
        <div className="${ns}-hero-record">
          ${explorable(
            plan,
            "0",
            null,
            `<Plate
            platform={platform}
            priority
            ratio="panorama"
            reference={project.hero}
            sizes="100vw"
          />`,
            "          ",
          )}
        </div>

        {project.story.map((block, index) => {
          /*
           * A beat with no photograph recomposes rather than leaving the media
           * column empty: the heading takes one column and the argument the
           * other, across the full measure.
           */
          const illustrated = block.media.length > 0;
          return (
            <section
              className="${ns}-beat"
              data-flip={illustrated && index % 2 === 1 ? "true" : "false"}
              data-media={illustrated ? "true" : "false"}
              key={block.blockId}
            >
              <div className="${ns}-beat-copy">
                <p className="${ns}-beat-index">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h2 className="${ns}-item-title">{block.heading}</h2>
                {illustrated ? (
                  <p className="${ns}-beat-body">{block.body}</p>
                ) : null}
              </div>
              {illustrated ? (
                <div className="${ns}-beat-media">
                  {block.media.map((reference) => (
                    ${explorable(
                      plan,
                      "exploreIndex(reference)",
                      "reference.assetId",
                      `<Plate
                        platform={platform}
                        ratio={ratioFor(media, reference.assetId, {
                          portrait: "tall",
                          landscape: "wide",
                        })}
                        reference={reference}
                        sizes="(max-width: ${breakpoints.wide}) 100vw, 52vw"
                      />`,
                      "                    ",
                    )}
                  ))}
                </div>
              ) : (
                <div className="${ns}-beat-aside">
                  <p className="${ns}-beat-body">{block.body}</p>
                </div>
              )}
            </section>
          );
        })}

${factsAndOnward(design)}

${onwardNav(design)}
      </div>`;
}

/**
 * Wraps a photograph so it becomes the way into the project's sequence at its
 * own position, when this client's language opens media at all.
 *
 * The photograph itself is untouched either way: exploration is added around
 * composed media, never substituted for it.
 */
function explorable(
  plan: InteractionPlan,
  indexExpression: string,
  keyExpression: string | null,
  plate: string,
  indent: string,
): string {
  const key = keyExpression === null ? "" : ` key={${keyExpression}}`;
  if (!plan.usesMediaExplorer) {
    // The key belongs on the outermost element either way.
    return key === "" ? plate : plate.replace("<Plate", `<Plate${key}`);
  }
  /*
   * The plate template carries whatever indentation it had where it was
   * written, which is not where it lands once it is nested inside a trigger.
   * Its own shape is preserved and the whole block is re-anchored, so generated
   * source stays readable rather than stair-stepping.
   */
  const lines = plate.split("\n");
  const rest = lines.slice(1).filter((line) => line.trim().length > 0);
  const base = Math.min(
    ...rest.map((line) => line.length - line.trimStart().length),
  );
  const body = lines
    .map((line, position) =>
      line.trim().length === 0
        ? line
        : position === 0
          ? `${indent}  ${line}`
          : `${indent}  ${line.slice(base)}`,
    )
    .join("\n");
  return `<Explore${key} index={${indexExpression}}>\n${body}\n${indent}</Explore>`;
}

/** Indents an emitted block by one level, so nesting it stays readable. */
function indent(block: string): string {
  return block
    .split("\n")
    .map((line) => (line.trim().length === 0 ? line : `  ${line}`))
    .join("\n");
}
