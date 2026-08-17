import {
  relatedProjects,
  siblingProjects,
  type ClientExperienceRouteProps,
} from "@proportion/client-experience";

import { Chrome } from "../components/Chrome";
import { Conductor } from "../components/Conductor";

/**
 * Project detail. Grammar: a vertical document with the Conductor running down
 * its left margin, connecting the hero to each story beat to the conversion
 * panel.
 *
 * This is the route that has to carry the claim, so it is the route that gets
 * the Signature, the substantial narrative and the media sequence. It is
 * materially a different shape from Home and from the register.
 */
export function ProjectDetailRoute(props: ClientExperienceRouteProps) {
  const { project, platform, profile, projects } = props;
  if (project === undefined) {
    throw new Error("Project detail route requires a resolved project.");
  }
  const related = relatedProjects(projects, project);
  const { previous, next } = siblingProjects(projects, project);
  /*
   * Onward records are labelled by the relationship that produced them. Every
   * card previously read "Next record", which made three different kinds of
   * link — a related job, the next in the register, the previous one — look
   * like the same repeated button.
   */
  const onward: readonly {
    project: NonNullable<typeof next>;
    relation: string;
  }[] =
    related.length > 0
      ? related.map((project) => ({ project, relation: "Related record" }))
      : [
          ...(next === undefined
            ? []
            : [{ project: next, relation: "Next in the register" }]),
          ...(previous === undefined
            ? []
            : [{ project: previous, relation: "Previous record" }]),
        ];

  const contact = profile.sections.flatMap((section) =>
    section.type === "ACTIONS" ? section.actions : [],
  );

  /*
   * Plates are numbered in the order the reader meets them, across the whole
   * record. Numbering them from the story index skipped every beat that carries
   * no drawing, so a record could run 01, 03, 04 and look like a missing sheet.
   */
  let plateNumber = 0;
  const nextPlate = () => String((plateNumber += 1)).padStart(2, "0");

  return (
    <Chrome {...props}>
      <div className="hea-document">
        <div className="hea-conductor">
          {/* One node per story beat, plus the outcome and the conversion panel. */}
          <Conductor nodeCount={project.story.length + 1} />
        </div>

        <div className="hea-document-body">
          <p className="hea-label">
            Record ·{" "}
            {project.locationLabel ?? "Location withheld"}
          </p>
          <h2 className="hea-document-title">{project.title}</h2>

          {project.truthMode === "DEMONSTRATION" &&
          project.demonstrationDisclosure !== undefined ? (
            <p
              className="hea-disclosure"
              data-disclosure="demonstration"
              role="note"
              style={{ marginTop: "2rem" }}
            >
              <strong style={{ display: "block", marginBottom: "0.25rem" }}>
                Demonstration record
              </strong>
              {project.demonstrationDisclosure}
            </p>
          ) : null}

          <figure className="hea-beat-plate" style={{ margin: "0 0 2rem" }}>
            <platform.Image
              reference={project.hero}
              priority
              sizes="(max-width: 60rem) 100vw, 62vw"
            />
            <figcaption className="hea-plate-caption">
              <span className="hea-label">Plate {nextPlate()}</span>
              <span className="hea-plate-note">
                {project.hero.decorative ? null : project.hero.caption}
              </span>
            </figcaption>
          </figure>

          <dl className="hea-facts">
            {project.facts.map((fact) => (
              <div className="hea-fact" key={fact.label}>
                <dt className="hea-label">{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>

          {project.story.map((block, index) => (
            <section
              className="hea-beat"
              data-beat-index={index}
              key={block.blockId}
            >
              <p className="hea-label hea-beat-index">
                {String(index + 1).padStart(2, "0")} — {block.type}
              </p>
              <h3>{block.heading}</h3>
              <p>{block.body}</p>
              {block.media.map((reference) => (
                <figure
                  className="hea-beat-plate"
                  key={reference.assetId}
                  style={{ marginBottom: 0 }}
                >
                  <platform.Image
                    reference={reference}
                    sizes="(max-width: 60rem) 100vw, 62vw"
                  />
                  <figcaption className="hea-plate-caption">
                    <span className="hea-label">Plate {nextPlate()}</span>
                    <span className="hea-plate-note">
                      {reference.decorative ? null : reference.caption}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </section>
          ))}

          <section
            aria-labelledby="hea-conversion-title"
            className="hea-conversion"
            data-beat-index={project.story.length}
          >
            <div>
              <p className="hea-label">Next step</p>
              <h2 id="hea-conversion-title">
                We quote from drawings, not from a phone call in a hallway.
              </h2>
              <p>
                Send the address and what you are planning. We will tell you
                what we would need to see on site, and what a documented job of
                this kind involves.
              </p>
            </div>
            <div className="hea-conversion-actions">
              {/*
                * The declared phone action is NOT_CONFIGURED and must remain so:
                * inventing a number for a fictional business is exactly the kind
                * of fabrication this proof refuses. The panel therefore leads
                * with the action that is real — the contact route — and keeps
                * the truthful notice beneath it rather than instead of it.
                */}
              <platform.Link href="/contact">
                <span className="hea-conversion-cta">Start a conversation</span>
              </platform.Link>
              {contact.map((action) => (
                <platform.Action actionId={action.actionId} key={action.actionId} />
              ))}
            </div>
          </section>

          {onward.length === 0 ? null : (
            <nav aria-label="Other records" className="hea-related">
              {onward.map(({ project: candidate, relation }) => (
                <platform.Link
                  href={`/projects/${candidate.slug}`}
                  key={candidate.projectId}
                >
                  <span>
                    <span className="hea-label">{relation}</span>
                    <span
                      className="hea-schedule-title"
                      style={{ display: "block", marginTop: "0.5rem" }}
                    >
                      {candidate.title}
                    </span>
                    <span
                      className="hea-label"
                      style={{ display: "block", marginTop: "0.75rem" }}
                    >
                      {candidate.locationLabel ?? "—"}
                    </span>
                  </span>
                </platform.Link>
              ))}
            </nav>
          )}
        </div>
      </div>
    </Chrome>
  );
}
