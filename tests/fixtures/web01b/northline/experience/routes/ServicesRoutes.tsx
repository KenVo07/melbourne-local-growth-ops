import {
  serviceById,
  type ClientExperienceRouteProps,
} from "@proportion/client-experience";

import { Chrome } from "../components/Chrome";

/**
 * Services index. Grammar: a specification list.
 *
 * Each service is a full-width entry with its number, its own plate and a
 * reading measure — not a card in a grid. The plate alternates side so the
 * page has a rhythm rather than a repeated block.
 */
export function ServicesIndexRoute(props: ClientExperienceRouteProps) {
  const { profile, platform } = props;
  const services = profile.sections.flatMap((section) =>
    section.type === "SERVICES" ? section.items : [],
  );
  const plates = [
    "plate-switchboard",
    "plate-schematic",
    "plate-circuit-plan",
  ] as const;

  return (
    <Chrome {...props}>
      <section className="hea-spec">
        <p className="hea-label">Scope of work</p>
        <h2 className="hea-hero-title" style={{ maxWidth: "16ch" }}>
          Three kinds of job, one way of working.
        </h2>

        {services.map((service, index) => (
          <article
            className="hea-spec-entry"
            data-flip={index % 2 === 1 ? "true" : "false"}
            key={service.serviceId ?? service.title}
          >
            <div className="hea-spec-body">
              <p className="hea-label">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="hea-spec-title">{service.title}</h3>
              <p className="hea-spec-text">{service.description}</p>
              {service.serviceId === undefined ? null : (
                <p style={{ marginTop: "2rem" }}>
                  <platform.Link href={`/services/${service.serviceId}`}>
                    <span className="hea-action">
                      How we approach it
                    </span>
                  </platform.Link>
                </p>
              )}
            </div>
            <figure className="hea-spec-plate">
              <platform.Image
                reference={{
                  assetId: plates[index % plates.length] ?? plates[0],
                  role: "CONTENT",
                  decorative: false,
                  alt: `Technical plate illustrating ${service.title.toLowerCase()}`,
                  presentation: {
                    aspect: "LANDSCAPE",
                    fit: "COVER",
                    focalPoint: { x: 0.5, y: 0.5 },
                    mobile: { aspect: "PANORAMIC", focalPoint: { x: 0.5, y: 0.5 } },
                  },
                }}
                sizes="(max-width: 60rem) 100vw, 38vw"
              />
            </figure>
          </article>
        ))}
      </section>
    </Chrome>
  );
}

/**
 * Service detail. Grammar: a narrow argument with a marginal fact rail.
 *
 * Short by design. A service page's job is to answer "is this the kind of firm
 * I want" and then move the reader to evidence, so it ends on the projects that
 * actually used it rather than on another call to action.
 */
export function ServiceDetailRoute(props: ClientExperienceRouteProps) {
  const { page, profile, projects, platform } = props;
  if (page.content.kind !== "SERVICE") {
    throw new Error("Service detail route requires SERVICE page content.");
  }
  const serviceId = page.content.serviceId;
  const service = serviceById(profile, serviceId);
  if (service === undefined) {
    throw new Error(
      `Service "${serviceId}" is not declared by the validated profile.`,
    );
  }
  const evidence = projects.projects.filter((project) =>
    project.serviceIds.includes(serviceId),
  );

  // Each service leads with the drawing type that job actually produces, so the
  // three detail pages do not share one illustration.
  const plateByService: Record<string, { assetId: string; alt: string }> = {
    rewiring: {
      assetId: "plate-wall-section",
      alt: "Vertical section through a stud wall showing the cable chase, studs in hatch, and three outlet positions taken off the run",
    },
    switchboards: {
      assetId: "plate-schematic",
      alt: "Single-line schematic showing the supply, main switch, busbar and eight final circuits with their terminating symbols",
    },
    lighting: {
      assetId: "plate-circuit-plan",
      alt: "Floor plan with the lighting circuit traced across four rooms, showing junction positions and ceiling fittings on drops",
    },
  };
  const plate = plateByService[serviceId];

  const effort: Record<string, readonly string[]> = {
    rewiring: [
      "Half a day on site to survey and draw before any price",
      "Room-by-room sequencing so you keep using the house",
      "Power off in one room at a time, not the whole dwelling",
    ],
    switchboards: [
      "A load assessment measured, not estimated from nameplates",
      "One planned outage, scheduled with you",
      "The old board left isolated and tagged until the new one is proven",
    ],
    lighting: [
      "A walk-through of how you actually use each room",
      "Switch positions marked on plan and agreed before any cable",
      "Ceiling access needed where fittings move",
    ],
  };

  return (
    <Chrome {...props}>
      <article className="hea-argument" data-service-id={serviceId}>
        <div className="hea-argument-body">
          <p className="hea-label">What we do · {service.title}</p>
          <h2 className="hea-document-title">{service.title}</h2>
          <p className="hea-argument-lede">{service.description}</p>
        </div>

        <aside className="hea-argument-rail">
          <p className="hea-label">Always included</p>
          <ul className="hea-rail-list">
            <li>A survey drawing before the quote</li>
            <li>Written scope tied to that drawing</li>
            <li>An as-built set when we finish</li>
            <li>Labels that name rooms, not numbers</li>
          </ul>

          <p className="hea-label" style={{ marginTop: "2.5rem" }}>
            What it asks of you
          </p>
          <ul className="hea-rail-list">
            {(effort[serviceId] ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </aside>

        {plate === undefined ? null : (
          <figure className="hea-argument-plate">
            <platform.Image
              reference={{
                assetId: plate.assetId,
                role: "CONTENT",
                decorative: false,
                alt: plate.alt,
                presentation: {
                  aspect: "LANDSCAPE",
                  fit: "COVER",
                  focalPoint: { x: 0.5, y: 0.5 },
                  mobile: { aspect: "LANDSCAPE", focalPoint: { x: 0.45, y: 0.5 } },
                },
              }}
              sizes="(max-width: 60rem) 100vw, 58vw"
            />
            <figcaption className="hea-plate-caption">
              <span className="hea-label">What this job produces</span>
              <span className="hea-label">Drawing type</span>
            </figcaption>
          </figure>
        )}

        {evidence.length === 0 ? null : (
          <div className="hea-argument-evidence">
            <p className="hea-label">Where you can see it</p>
            {evidence.map((project) => (
              <platform.Link
                href={`/projects/${project.slug}`}
                key={project.projectId}
              >
                <span className="hea-evidence-row">
                  <span className="hea-schedule-title">{project.title}</span>
                  <span className="hea-label">
                    {project.locationLabel ?? "—"}
                  </span>
                </span>
              </platform.Link>
            ))}
          </div>
        )}
      </article>
    </Chrome>
  );
}
