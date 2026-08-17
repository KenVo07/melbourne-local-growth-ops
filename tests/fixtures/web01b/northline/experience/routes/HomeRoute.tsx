import type { ClientExperienceRouteProps } from "@proportion/client-experience";

import { Chrome } from "../components/Chrome";

/**
 * Home. Grammar: a wide asymmetric title block against one plate.
 *
 * The first viewport carries identity, offer and action together — the v1
 * showcase led with cinematic media and buried all three, which is the specific
 * failure this composition exists to avoid.
 */
export function HomeRoute(props: ClientExperienceRouteProps) {
  const { projects, platform } = props;
  const lead = projects.projects[0];

  return (
    <Chrome {...props}>
      <section className="hea-hero">
        <div>
          <p className="hea-label">Switchboards · Lighting · Rewiring</p>
          <h2 className="hea-hero-title">
            The part of your home you will <em>never see</em> is the part worth
            documenting.
          </h2>
          <p className="hea-hero-lede">
            We work on older inner-Melbourne houses where the wiring has been
            added to for decades. Every job we take on is drawn before it is
            cut, and drawn again once it is closed up, so you own a record of
            what is actually behind your walls.
          </p>
          <div className="hea-hero-actions">
            <platform.Link href="/projects">
              <span className="hea-action">See how we document a job</span>
            </platform.Link>
            <span className="hea-label">Or call — we quote from drawings</span>
          </div>
        </div>

        <figure className="hea-hero-plate" style={{ margin: 0 }}>
          <platform.Image
            reference={{
              assetId: "plate-switchboard",
              role: "HERO",
              decorative: false,
              alt: "Orthographic drawing of a residential switchboard elevation, showing two rails of circuit breakers, a main isolator and the conductor run leaving the board",
              presentation: {
                aspect: "LANDSCAPE",
                fit: "COVER",
                focalPoint: { x: 0.5, y: 0.5 },
                mobile: { focalPoint: { x: 0.45, y: 0.5 } },
              },
            }}
            priority
            sizes="(max-width: 60rem) 100vw, 40vw"
          />
          <figcaption className="hea-plate-caption">
            <span className="hea-label">Plate 01 — Board elevation</span>
            <span className="hea-label">1:20</span>
          </figcaption>
        </figure>
      </section>

      {lead === undefined ? null : (
        <section aria-labelledby="hea-lead-project" className="hea-lead">
          <div>
            <p className="hea-label">Most recent record</p>
            <h2 className="hea-schedule-title" id="hea-lead-project">
              {lead.title}
            </h2>
            <p className="hea-schedule-summary">{lead.summary}</p>
            <p style={{ marginTop: "2rem" }}>
              <platform.Link href={`/projects/${lead.slug}`}>
                <span className="hea-action">Read the record</span>
              </platform.Link>
            </p>
          </div>
          <dl className="hea-lead-meta">
            {lead.facts.map((fact) => (
              <div key={fact.label}>
                <dt className="hea-label">{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
            <div>
              <dt className="hea-label">Location</dt>
              <dd>{lead.locationLabel ?? "—"}</dd>
            </div>
            <div>
              <dt className="hea-label">Status</dt>
              <dd>Demonstration</dd>
            </div>
          </dl>
        </section>
      )}
    </Chrome>
  );
}
