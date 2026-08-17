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
  const onward = related.length > 0 ? related : [next, previous].filter(
    (candidate): candidate is NonNullable<typeof candidate> =>
      candidate !== undefined,
  );

  const contact = profile.sections.flatMap((section) =>
    section.type === "ACTIONS" ? section.actions : [],
  );

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
              <span className="hea-label">Plate 01 — As documented</span>
              <span className="hea-label">1:50</span>
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
                    <span className="hea-label">
                      Plate {String(index + 2).padStart(2, "0")}
                    </span>
                    <span className="hea-label">Detail</span>
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
              {contact.map((action) => (
                <platform.Action actionId={action.actionId} key={action.actionId} />
              ))}
            </div>
          </section>

          {onward.length === 0 ? null : (
            <nav aria-label="Other records" className="hea-related">
              {onward.map((candidate) => (
                <platform.Link
                  href={`/projects/${candidate.slug}`}
                  key={candidate.projectId}
                >
                  <span>
                    <span className="hea-label">Next record</span>
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
