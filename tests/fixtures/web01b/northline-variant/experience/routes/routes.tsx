import type { ReactNode } from "react";
import {
  navigationHref,
  relatedProjects,
  serviceById,
  type ClientExperienceNotFoundProps,
  type ClientExperienceRouteProps,
} from "@proportion/client-experience";

import "../styles/site.css";

/**
 * "Night shift" — the same-profile variation.
 *
 * Bounded on purpose. It reads the identical validated page graph, projects and
 * profile as the flagship, and reaches them through the identical Platform
 * primitives. Only the authored composition differs, which is exactly what this
 * proof has to demonstrate: no Core change, no profile fork, no second
 * repository.
 */
function Shell({
  site,
  page,
  pageGraph,
  platform,
  children,
}: Pick<
  ClientExperienceRouteProps,
  "site" | "page" | "pageGraph" | "platform"
> & { readonly children: ReactNode }) {
  const action = pageGraph.navigation.primaryAction;
  return (
    <div className="nsh" data-page-kind={page.kind}>
      <platform.SkipLink className="nsh-skip" />
      <div className="nsh-shell">
        <header className="nsh-header">
          <p className="nsh-wordmark">{site.businessName}</p>
          <nav aria-label="Primary" className="nsh-nav">
            <ul>
              {pageGraph.navigation.primary.map((item) => (
                <li key={item.navigationId}>
                  <platform.Link href={navigationHref(pageGraph, item.target)}>
                    {item.label}
                  </platform.Link>
                </li>
              ))}
              <li>
                <platform.Search />
              </li>
              {action === undefined ? null : (
                <li>
                  <platform.Link
                    href={navigationHref(pageGraph, action.target)}
                  >
                    <span className="nsh-action">{action.label}</span>
                  </platform.Link>
                </li>
              )}
            </ul>
          </nav>
        </header>
      </div>

      <platform.Main className="nsh-main">{children}</platform.Main>

      <div className="nsh-shell">
        <footer className="nsh-footer">
          <nav aria-label="Footer">
            <ul>
              {pageGraph.navigation.footer.map((item) => (
                <li key={item.navigationId}>
                  <platform.Link href={navigationHref(pageGraph, item.target)}>
                    {item.label}
                  </platform.Link>
                </li>
              ))}
            </ul>
          </nav>
          <p>Fictional business · Demonstration content only</p>
        </footer>
      </div>
    </div>
  );
}

function Media({
  platform,
  assetId,
  alt,
  caption,
}: Pick<ClientExperienceRouteProps, "platform"> & {
  readonly assetId: string;
  readonly alt: string;
  readonly caption: string;
}) {
  return (
    <figure className="nsh-media">
      <platform.Image
        reference={{
          assetId,
          role: "CONTENT",
          decorative: false,
          alt,
          presentation: {
            aspect: "PANORAMIC",
            fit: "COVER",
            focalPoint: { x: 0.5, y: 0.5 },
            mobile: { aspect: "LANDSCAPE", focalPoint: { x: 0.5, y: 0.5 } },
          },
        }}
        sizes="100vw"
      />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function HomeRoute(props: ClientExperienceRouteProps) {
  const { projects, platform } = props;
  return (
    <Shell {...props}>
      <div className="nsh-shell">
        <p className="nsh-eyebrow">Residential electrical · Inner Melbourne</p>
        <h1 className="nsh-title">Work you will never see, written down.</h1>
        <p className="nsh-lede">
          We rewire older houses and leave behind a record of what is behind the
          plaster. Slower to quote. Considerably easier to live with.
        </p>
      </div>
      <Media
        {...props}
        assetId="plate-facade"
        alt="Orthographic elevation of a terrace facade with the supply run marked"
        caption="Northcote terrace — supply run, as documented"
      />
      <div className="nsh-shell">
        <ul className="nsh-list">
          {projects.projects.map((project) => (
            <li key={project.projectId}>
              <platform.Link href={`/projects/${project.slug}`}>
                <p className="nsh-eyebrow">{project.locationLabel ?? "—"}</p>
                <h2 className="nsh-entry-title">{project.title}</h2>
                <p className="nsh-entry-text">{project.summary}</p>
              </platform.Link>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  );
}

export function ServicesIndexRoute(props: ClientExperienceRouteProps) {
  const { profile, platform } = props;
  const services = profile.sections.flatMap((section) =>
    section.type === "SERVICES" ? section.items : [],
  );
  return (
    <Shell {...props}>
      <div className="nsh-shell">
        <p className="nsh-eyebrow">What we do</p>
        <h1 className="nsh-title">Three kinds of job.</h1>
        <ul className="nsh-list">
          {services.map((service) => (
            <li key={service.serviceId ?? service.title}>
              {service.serviceId === undefined ? (
                <h2 className="nsh-entry-title">{service.title}</h2>
              ) : (
                <platform.Link href={`/services/${service.serviceId}`}>
                  <h2 className="nsh-entry-title">{service.title}</h2>
                </platform.Link>
              )}
              <p className="nsh-entry-text">{service.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  );
}

export function ServiceDetailRoute(props: ClientExperienceRouteProps) {
  const { page, profile } = props;
  if (page.content.kind !== "SERVICE") {
    throw new Error("Service detail route requires SERVICE page content.");
  }
  const service = serviceById(profile, page.content.serviceId);
  if (service === undefined) {
    throw new Error(`Service "${page.content.serviceId}" is not declared.`);
  }
  return (
    <Shell {...props}>
      <div className="nsh-shell" data-service-id={page.content.serviceId}>
        <p className="nsh-eyebrow">What we do</p>
        <h1 className="nsh-title">{service.title}</h1>
        <p className="nsh-lede">{service.description}</p>
      </div>
    </Shell>
  );
}

export function ProjectsIndexRoute(props: ClientExperienceRouteProps) {
  const { projects, platform } = props;
  return (
    <Shell {...props}>
      <div className="nsh-shell">
        <p className="nsh-eyebrow">Record of works</p>
        <h1 className="nsh-title">Every job, written down.</h1>
        <ul className="nsh-list">
          {projects.projects.map((project) => (
            <li key={project.projectId}>
              <platform.Link href={`/projects/${project.slug}`}>
                <p className="nsh-eyebrow">{project.locationLabel ?? "—"}</p>
                <h2 className="nsh-entry-title">{project.title}</h2>
                <p className="nsh-entry-text">{project.summary}</p>
              </platform.Link>
            </li>
          ))}
        </ul>
      </div>
    </Shell>
  );
}

export function ProjectDetailRoute(props: ClientExperienceRouteProps) {
  const { project, projects, profile, platform } = props;
  if (project === undefined) {
    throw new Error("Project detail route requires a resolved project.");
  }
  const related = relatedProjects(projects, project);
  const actions = profile.sections.flatMap((section) =>
    section.type === "ACTIONS" ? section.actions : [],
  );

  return (
    <Shell {...props}>
      <div className="nsh-shell">
        <p className="nsh-eyebrow">{project.locationLabel ?? "—"}</p>
        <h1 className="nsh-title">{project.title}</h1>
        {project.truthMode === "DEMONSTRATION" &&
        project.demonstrationDisclosure !== undefined ? (
          <p className="nsh-note" data-disclosure="demonstration" role="note">
            <strong>Demonstration record.</strong>{" "}
            {project.demonstrationDisclosure}
          </p>
        ) : null}
        <p className="nsh-lede">{project.summary}</p>
      </div>

      <Media
        {...props}
        assetId={project.hero.assetId}
        alt={project.hero.decorative ? "" : project.hero.alt}
        caption={`${project.title} — as documented`}
      />

      <div className="nsh-shell">
        <dl className="nsh-facts">
          {project.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>

        <div className="nsh-body">
          {project.story.map((block) => (
            <section className="nsh-beat" key={block.blockId}>
              <p className="nsh-eyebrow">{block.type}</p>
              <h2>{block.heading}</h2>
              <p>{block.body}</p>
            </section>
          ))}
        </div>

        <section className="nsh-cta">
          <p className="nsh-eyebrow">Next step</p>
          <h2>Send the address and what you are planning.</h2>
          <div className="nsh-cta-actions">
            {actions.map((action) => (
              <platform.Action actionId={action.actionId} key={action.actionId} />
            ))}
          </div>
        </section>

        {related.length === 0 ? null : (
          <ul className="nsh-list">
            {related.map((candidate) => (
              <li key={candidate.projectId}>
                <platform.Link href={`/projects/${candidate.slug}`}>
                  <p className="nsh-eyebrow">Next record</p>
                  <h2 className="nsh-entry-title">{candidate.title}</h2>
                </platform.Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}

export function AboutRoute(props: ClientExperienceRouteProps) {
  const { page, profile } = props;
  if (page.content.kind !== "PROFILE_SECTIONS") {
    throw new Error("About route requires PROFILE_SECTIONS page content.");
  }
  const wanted = new Set(page.content.sectionIds);
  return (
    <Shell {...props}>
      <div className="nsh-shell">
        <p className="nsh-eyebrow">How we work</p>
        <h1 className="nsh-title">Drawing first.</h1>
        <div className="nsh-body" style={{ marginTop: "3rem" }}>
          <p>
            We survey and draw what is actually there before we price anything.
            It costs a morning and removes most of the argument.
          </p>
          {profile.sections
            .filter((section) => wanted.has(section.sectionId))
            .map((section) => (
              <section className="nsh-beat" key={section.sectionId}>
                <h2>{section.heading}</h2>
                {section.type === "TRUST_SIGNALS" ? (
                  <>
                    <ul>
                      {section.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    {section.disclaimer === undefined ? null : (
                      <p className="nsh-note">{section.disclaimer}</p>
                    )}
                  </>
                ) : null}
                {section.type === "PROCESS" ? (
                  <ol>
                    {section.items.map((item) => (
                      <li key={item.title}>
                        <strong>{item.title}</strong> — {item.description}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </section>
            ))}
        </div>
      </div>
    </Shell>
  );
}

export function ContactRoute(props: ClientExperienceRouteProps) {
  const { profile, platform } = props;
  const actions = profile.sections.flatMap((section) =>
    section.type === "ACTIONS" ? section.actions : [],
  );
  return (
    <Shell {...props}>
      <div className="nsh-shell">
        <p className="nsh-eyebrow">Start a conversation</p>
        <h1 className="nsh-title">Tell us what you are planning.</h1>
        <div className="nsh-cta-actions" style={{ marginTop: "2.5rem" }}>
          {actions.map((action) => (
            <platform.Action actionId={action.actionId} key={action.actionId} />
          ))}
        </div>
        <div style={{ marginTop: "3.5rem" }}>
          <platform.Region regionId="primary" />
        </div>
      </div>
    </Shell>
  );
}

/**
 * Not found. The variation answers a missing page the way it answers everything
 * else: one oversized line on the dark ground, then the routes that do exist.
 *
 * It proves the same point the rest of this experience does — the 404 is part of
 * the authored surface, so two sites on one Kernel can disagree about it
 * completely. Like the flagship's, it is told nothing about the requested path.
 */
export function NotFoundRoute({
  site,
  pageGraph,
  platform,
}: ClientExperienceNotFoundProps) {
  return (
    <div className="nsh" data-page-kind="NOT_FOUND">
      <platform.SkipLink className="nsh-skip" />
      <div className="nsh-shell">
        <header className="nsh-header">
          <p className="nsh-wordmark">{site.businessName}</p>
        </header>
      </div>

      <platform.Main className="nsh-main">
        <div className="nsh-shell">
          <p className="nsh-eyebrow">No record at this address</p>
          <h1 className="nsh-title">Nothing was filed here.</h1>
          <p className="nsh-lede">
            That page is not part of this site. These are the ones that are.
          </p>
          <ul className="nsh-list">
            {pageGraph.navigation.primary.map((item) => (
              <li key={item.navigationId}>
                <platform.Link href={navigationHref(pageGraph, item.target)}>
                  <h2 className="nsh-entry-title">{item.label}</h2>
                </platform.Link>
              </li>
            ))}
          </ul>
        </div>
      </platform.Main>

      <div className="nsh-shell">
        <footer className="nsh-footer">
          <nav aria-label="Footer">
            <ul>
              {pageGraph.navigation.footer.map((item) => (
                <li key={item.navigationId}>
                  <platform.Link href={navigationHref(pageGraph, item.target)}>
                    {item.label}
                  </platform.Link>
                </li>
              ))}
            </ul>
          </nav>
          <p>Fictional business · Demonstration content only</p>
        </footer>
      </div>
    </div>
  );
}
