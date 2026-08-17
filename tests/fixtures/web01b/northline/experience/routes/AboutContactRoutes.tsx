import type { ClientExperienceRouteProps } from "@proportion/client-experience";

import { Chrome } from "../components/Chrome";

/**
 * About. Grammar: prose on a narrow measure with a marginal annotation column,
 * the way a drawing carries notes beside the drawing rather than beneath it.
 *
 * No team photographs and no credentials are claimed, because none have been
 * verified for this fictional business. The page argues a method instead, which
 * is what it can honestly do.
 */
export function AboutRoute(props: ClientExperienceRouteProps) {
  const { page, profile, platform } = props;
  if (page.content.kind !== "PROFILE_SECTIONS") {
    throw new Error("About route requires PROFILE_SECTIONS page content.");
  }
  const wanted = new Set(page.content.sectionIds);
  const sections = profile.sections.filter((section) =>
    wanted.has(section.sectionId),
  );

  return (
    <Chrome {...props}>
      <article className="hea-notes">
        <header className="hea-notes-head">
          <p className="hea-label">How we work</p>
          <h2 className="hea-hero-title" style={{ maxWidth: "15ch" }}>
            Drawing first is slower once and faster afterwards.
          </h2>
        </header>

        <div className="hea-notes-body">
          <p>
            Most electrical quoting is done from a walk-through and a guess. It
            is quick, and it is why so much work ends in a variation. We survey
            and draw what is actually there before we price anything, which
            costs a morning and removes most of the argument.
          </p>
          <p>
            The drawing is also what you keep. When the plaster goes back on,
            the only record of what is behind it is the one somebody made
            deliberately. We make two: what we found, and what we left.
          </p>
          <p>
            We are not the cheapest way to get a light switch moved, and we
            would rather say so early. For a whole house, or a job you intend to
            live with for twenty years, the documentation is most of the value.
          </p>
        </div>

        <aside className="hea-notes-margin">
          {sections.map((section) => (
            <section key={section.sectionId}>
              <p className="hea-label">{section.heading}</p>
              {section.type === "TRUST_SIGNALS" ? (
                <>
                  <ul className="hea-rail-list">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {section.disclaimer === undefined ? null : (
                    <p className="hea-note-caveat">{section.disclaimer}</p>
                  )}
                </>
              ) : null}
              {section.type === "PROCESS" ? (
                <ol className="hea-rail-list hea-rail-numbered">
                  {section.items.map((item) => (
                    <li key={item.title}>
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          ))}
        </aside>

        <figure className="hea-notes-plate">
          <platform.Image
            reference={{
              assetId: "plate-cable-schedule",
              role: "CONTENT",
              decorative: false,
              alt: "Drawn cable schedule plate: a ruled table of circuit rows with reference, description, rating and protection columns",
              presentation: {
                aspect: "SQUARE",
                fit: "COVER",
                focalPoint: { x: 0.5, y: 0.5 },
                mobile: { aspect: "LANDSCAPE", focalPoint: { x: 0.5, y: 0.35 } },
              },
            }}
            sizes="(max-width: 60rem) 100vw, 30vw"
          />
          <figcaption className="hea-plate-caption">
            <span className="hea-label">Schedule — as issued</span>
            <span className="hea-label">Sheet 3</span>
          </figcaption>
        </figure>
      </article>
    </Chrome>
  );
}

/**
 * Contact. Grammar: one decisive panel.
 *
 * Deliberately the shortest route on the site. Everything that could distract
 * from starting the conversation has been removed, and the validated contact
 * module is rendered through PlatformRegion so its safe-failure behaviour is
 * the Kernel's, not this experience's.
 */
export function ContactRoute(props: ClientExperienceRouteProps) {
  const { profile, platform } = props;
  const actions = profile.sections.flatMap((section) =>
    section.type === "ACTIONS" ? section.actions : [],
  );

  return (
    <Chrome {...props}>
      <section className="hea-contact">
        <div className="hea-contact-lead">
          <p className="hea-label">Start a conversation</p>
          <h2 className="hea-document-title" style={{ maxWidth: "14ch" }}>
            Tell us the address and what you are planning.
          </h2>
          <p className="hea-argument-lede">
            We will tell you what we would need to see on site, roughly what a
            documented job of that kind involves, and whether we are the right
            firm for it. If we are not, we will say so.
          </p>
          <div className="hea-contact-actions">
            {actions.map((action) => (
              <platform.Action actionId={action.actionId} key={action.actionId} />
            ))}
          </div>
        </div>

        <div className="hea-contact-form">
          <platform.Region regionId="primary" />
        </div>
      </section>
    </Chrome>
  );
}
