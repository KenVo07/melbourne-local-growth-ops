import type { ReactNode } from "react";
import {
  navigationHref,
  type ClientExperienceRouteProps,
} from "@proportion/client-experience";

import "../styles/site.css";

type ChromeProps = Pick<
  ClientExperienceRouteProps,
  "site" | "page" | "pageGraph" | "platform"
> & { readonly children: ReactNode };

/**
 * Shared chrome. Deliberately thin: the header, footer and grid ground are the
 * only things every route shares. Each route composes its own body grammar,
 * because a shared body shell is exactly what made the v1 showcase read as one
 * template.
 */
export function Chrome({ site, page, pageGraph, platform, children }: ChromeProps) {
  const action = pageGraph.navigation.primaryAction;

  return (
    <div className="hea" data-page-kind={page.kind}>
      {/*
        * Skip link and main landmark. Every route composes its own body, so
        * without these a keyboard or screen-reader user has to walk the header
        * on each page and has no landmark to jump to.
        */}
      <platform.SkipLink className="hea-skip" />
      <div className="hea-shell">
        <header className="hea-header">
          <div>
            <p className="hea-label">Residential electrical · Inner Melbourne</p>
            <h1 className="hea-wordmark">
              <span>{site.businessName}</span>
            </h1>
          </div>
          {action === undefined ? null : (
            <span className="hea-action-slot">
              <platform.Link href={navigationHref(pageGraph, action.target)}>
                <span className="hea-action">{action.label}</span>
              </platform.Link>
            </span>
          )}

          <div className="hea-header-controls">
            <nav aria-label="Primary" className="hea-nav">
              <ul>
                {pageGraph.navigation.primary.map((item) => {
                  const href = navigationHref(pageGraph, item.target);
                  const current = item.target.pageId === page.pageId;
                  return (
                    <li key={item.navigationId}>
                      <platform.Link
                        href={href}
                        {...(current ? { "aria-label": `${item.label}, current page` } : {})}
                      >
                        {item.label}
                      </platform.Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <platform.Search />
          </div>
        </header>

        <platform.Main>{children}</platform.Main>

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
