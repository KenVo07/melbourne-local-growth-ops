import {
  relatedProjects,
  siblingProjects,
  type ClientExperienceRouteProps,
} from "@proportion/client-experience";

import { NeutralShell } from "./shell";

/** Projects index. Projects are their own route, not a homepage section. */
export function ProjectsIndexRoute(props: ClientExperienceRouteProps) {
  return (
    <NeutralShell {...props}>
      <ul>
        {props.projects.projects.map((project) => (
          <li key={project.projectId}>
            <props.platform.Link href={`/projects/${project.slug}`}>
              {project.title}
            </props.platform.Link>
            <p>{project.summary}</p>
            <props.platform.Image
              reference={project.hero}
              sizes="(max-width: 48rem) 100vw, 33vw"
            />
          </li>
        ))}
      </ul>
    </NeutralShell>
  );
}

/**
 * Project detail. Proves the ordered story, client-owned media with focal
 * points, facts, relationships and — critically — that a DEMONSTRATION project
 * always renders its disclosure so concept work cannot read as client evidence.
 */
export function ProjectDetailRoute(props: ClientExperienceRouteProps) {
  const project = props.project;
  if (project === undefined) {
    throw new Error("Project detail route requires a resolved project.");
  }
  const related = relatedProjects(props.projects, project);
  const { previous, next } = siblingProjects(props.projects, project);

  return (
    <NeutralShell {...props}>
      {project.truthMode === "DEMONSTRATION" &&
      project.demonstrationDisclosure !== undefined ? (
        <p data-disclosure="demonstration" role="note">
          {project.demonstrationDisclosure}
        </p>
      ) : null}

      <p>{project.summary}</p>
      {project.locationLabel === undefined ? null : (
        <p data-location>{project.locationLabel}</p>
      )}

      <props.platform.Image
        reference={project.hero}
        priority
        sizes="(max-width: 48rem) 100vw, 66vw"
      />

      <dl>
        {project.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>

      {project.story.map((block) => (
        <section key={block.blockId} aria-label={block.heading}>
          <h2>{block.heading}</h2>
          <p>{block.body}</p>
          {block.media.map((reference) => (
            <props.platform.Image
              key={reference.assetId}
              reference={reference}
              sizes="(max-width: 48rem) 100vw, 50vw"
            />
          ))}
        </section>
      ))}

      {project.gallery.map((reference) => (
        <props.platform.Image
          key={reference.assetId}
          reference={reference}
          sizes="(max-width: 48rem) 100vw, 50vw"
        />
      ))}

      {related.length === 0 ? null : (
        <nav aria-label="Related projects">
          <ul>
            {related.map((candidate) => (
              <li key={candidate.projectId}>
                <props.platform.Link href={`/projects/${candidate.slug}`}>
                  {candidate.title}
                </props.platform.Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <nav aria-label="Project sequence">
        {previous === undefined ? null : (
          <props.platform.Link href={`/projects/${previous.slug}`}>
            Previous: {previous.title}
          </props.platform.Link>
        )}
        {next === undefined ? null : (
          <props.platform.Link href={`/projects/${next.slug}`}>
            Next: {next.title}
          </props.platform.Link>
        )}
      </nav>
    </NeutralShell>
  );
}
