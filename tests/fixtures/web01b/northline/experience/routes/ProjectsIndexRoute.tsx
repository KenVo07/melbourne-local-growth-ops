import {
  serviceById,
  type ClientExperienceRouteProps,
} from "@proportion/client-experience";

import { Chrome } from "../components/Chrome";

/**
 * Projects index. Grammar: an indexed schedule, closer to a drawing register
 * than a gallery.
 *
 * Deliberately not a grid of image cards. A register communicates that these
 * are records with numbers, locations and scope — which is the claim the
 * business is making — where a card grid would communicate "portfolio".
 */
export function ProjectsIndexRoute(props: ClientExperienceRouteProps) {
  const { profile, projects, platform } = props;

  /*
   * The scope column showed raw service identifiers. They are stable route keys,
   * not display text, and resolving them through the profile is the same lookup
   * the service routes use — the register never routes or labels by title.
   */
  const scopeOf = (serviceIds: readonly string[]) =>
    serviceIds
      .map((serviceId) => serviceById(profile, serviceId)?.title ?? serviceId)
      .join(" · ");

  return (
    <Chrome {...props}>
      <section className="hea-schedule">
        <p className="hea-label">Record of works</p>
        <h2 className="hea-hero-title" style={{ maxWidth: "18ch" }}>
          Every job, drawn and kept.
        </h2>
        <p className="hea-hero-lede" style={{ marginBottom: "3rem" }}>
          These are demonstration records created to show how we document work.
          A real register would carry the same fields.
        </p>

        <div className="hea-schedule-head">
          <span className="hea-label">No.</span>
          <span className="hea-label">Record</span>
          <span className="hea-label">Location</span>
          <span className="hea-label">Scope</span>
        </div>

        {projects.projects.map((project, index) => (
          <platform.Link
            href={`/projects/${project.slug}`}
            key={project.projectId}
          >
            <span className="hea-schedule-row">
              <span className="hea-label">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <span className="hea-schedule-title">{project.title}</span>
                <span
                  className="hea-schedule-summary"
                  style={{ display: "block" }}
                >
                  {project.summary}
                </span>
              </span>
              <span className="hea-label">
                {project.locationLabel ?? "—"}
              </span>
              <span className="hea-schedule-scope">
                {scopeOf(project.serviceIds)}
              </span>
            </span>
          </platform.Link>
        ))}
      </section>
    </Chrome>
  );
}
