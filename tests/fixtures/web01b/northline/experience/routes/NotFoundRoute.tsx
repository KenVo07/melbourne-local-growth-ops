import {
  navigationHref,
  type ClientExperienceNotFoundProps,
} from "@proportion/client-experience";

import "../styles/site.css";

/**
 * Not found. Grammar: a drawing sheet with nothing drawn on it.
 *
 * The joke is the site's own: a firm whose argument is "everything gets drawn
 * and kept" answers a missing page with an empty plate and a note explaining
 * that this sheet was never issued. It is the same chrome, the same grid and the
 * same type as every other route, because a 404 that looks like a different
 * website is the moment a visitor decides the site is broken.
 *
 * It is told nothing about the requested path, so it cannot echo it back or
 * disclose anything about the route table.
 */
export function NotFoundRoute({
  site,
  pageGraph,
  platform,
}: ClientExperienceNotFoundProps) {
  return (
    <div className="hea" data-page-kind="NOT_FOUND">
      <div className="hea-shell">
        <header className="hea-header">
          <div>
            <p className="hea-label">Residential electrical · Inner Melbourne</p>
            <h1 className="hea-wordmark">
              <span>{site.businessName}</span>
            </h1>
          </div>
        </header>

        <main className="hea-missing">
          <div className="hea-missing-body">
            <p className="hea-label">Sheet not issued</p>
            <h2 className="hea-hero-title" style={{ maxWidth: "13ch" }}>
              There is no drawing at this address.
            </h2>
            <p className="hea-hero-lede">
              The page you asked for is not part of this site. It may have been
              moved, or the address may have picked up a typo on the way here.
              Everything we do publish is one of these:
            </p>

            <nav aria-label="Recovery navigation" className="hea-missing-nav">
              <ul>
                {pageGraph.navigation.primary.map((item) => (
                  <li key={item.navigationId}>
                    <platform.Link
                      href={navigationHref(pageGraph, item.target)}
                    >
                      <span className="hea-missing-link">{item.label}</span>
                    </platform.Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          {/*
            * A blank plate, drawn in CSS rather than served as an image. There is
            * no asset for "nothing here", and inventing one would mean shipping a
            * tenth-of-a-megabyte drawing of an empty rectangle.
            */}
          <figure aria-hidden="true" className="hea-missing-plate">
            <div className="hea-missing-plate-field" />
            <figcaption className="hea-plate-caption">
              <span className="hea-label">Plate —</span>
              <span className="hea-plate-note">Not issued</span>
            </figcaption>
          </figure>
        </main>

        <footer className="hea-footer">
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
          <p className="hea-label">
            Fictional business · Demonstration content only
          </p>
        </footer>
      </div>
    </div>
  );
}
