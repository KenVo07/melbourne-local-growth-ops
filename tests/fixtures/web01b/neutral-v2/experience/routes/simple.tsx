import {
  serviceById,
  type ClientExperienceRouteProps,
} from "@proportion/client-experience";

import { NeutralShell } from "./shell";

/** Home. Proves the root route renders through the authored registry. */
export function HomeRoute(props: ClientExperienceRouteProps) {
  return (
    <NeutralShell {...props}>
      <p data-region="intro">{props.site.tagline ?? props.site.businessName}</p>
      <section aria-label="Featured projects">
        {props.projects.projects.map((project) => (
          <article key={project.projectId}>
            <h2>{project.title}</h2>
            <p>{project.summary}</p>
            <props.platform.Link href={`/projects/${project.slug}`}>
              Read {project.title}
            </props.platform.Link>
          </article>
        ))}
      </section>
    </NeutralShell>
  );
}

/** Services index, read from validated profile SERVICES content. */
export function ServicesIndexRoute(props: ClientExperienceRouteProps) {
  const services = props.profile.sections.flatMap((section) =>
    section.type === "SERVICES" ? section.items : [],
  );
  return (
    <NeutralShell {...props}>
      <ul>
        {services.map((service) => (
          <li key={service.serviceId ?? service.title}>
            {service.serviceId === undefined ? (
              <span>{service.title}</span>
            ) : (
              <props.platform.Link href={`/services/${service.serviceId}`}>
                {service.title}
              </props.platform.Link>
            )}
            <p>{service.description}</p>
          </li>
        ))}
      </ul>
    </NeutralShell>
  );
}

/**
 * Service detail. Resolves the exact stable service ID from the page's content
 * reference; there is no title or slug fallback anywhere.
 */
export function ServiceDetailRoute(props: ClientExperienceRouteProps) {
  if (props.page.content.kind !== "SERVICE") {
    throw new Error("Service detail route requires SERVICE page content.");
  }
  const service = serviceById(props.profile, props.page.content.serviceId);
  if (service === undefined) {
    throw new Error(
      `Service "${props.page.content.serviceId}" is not declared by the validated profile.`,
    );
  }
  return (
    <NeutralShell {...props}>
      <p data-service-id={props.page.content.serviceId}>
        {service.description}
      </p>
    </NeutralShell>
  );
}

/** About, rendered from the exact validated profile sections the page names. */
export function AboutRoute(props: ClientExperienceRouteProps) {
  if (props.page.content.kind !== "PROFILE_SECTIONS") {
    throw new Error("About route requires PROFILE_SECTIONS page content.");
  }
  const wanted = new Set(props.page.content.sectionIds);
  return (
    <NeutralShell {...props}>
      {props.profile.sections
        .filter((section) => wanted.has(section.sectionId))
        .map((section) => (
          <section key={section.sectionId} aria-label={section.heading}>
            <h2>{section.heading}</h2>
          </section>
        ))}
    </NeutralShell>
  );
}

/** Contact, proving a validated module region and external actions render. */
export function ContactRoute(props: ClientExperienceRouteProps) {
  const actions = props.profile.sections.flatMap((section) =>
    section.type === "ACTIONS" ? section.actions : [],
  );
  return (
    <NeutralShell {...props}>
      {actions.map((action) => (
        <props.platform.Action key={action.actionId} actionId={action.actionId} />
      ))}
      <props.platform.Region regionId="primary" />
    </NeutralShell>
  );
}
