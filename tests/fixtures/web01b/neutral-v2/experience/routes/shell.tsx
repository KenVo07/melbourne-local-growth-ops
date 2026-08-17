import type { ReactNode } from "react";
import {
  navigationHref,
  type ClientExperienceRouteProps,
} from "@proportion/client-experience";

/**
 * Deliberately plain shared chrome for the neutral functional fixture.
 *
 * This is NOT the reference-class proof. It exists so that route generation,
 * content resolution, navigation targets and metadata can be verified without
 * any creative decision in the way. It ships no CSS beyond browser defaults and
 * no client JavaScript.
 */
export function NeutralShell({
  site,
  page,
  pageGraph,
  platform,
  children,
}: Pick<
  ClientExperienceRouteProps,
  "site" | "page" | "pageGraph" | "platform"
> & { readonly children: ReactNode }) {
  return (
    <div data-fixture="neutral-functional" data-page-id={page.pageId}>
      <header>
        <p>{site.businessName}</p>
        <nav aria-label="Primary">
          <ul>
            {pageGraph.navigation.primary.map((item) => (
              <li key={item.navigationId}>
                <platform.Link href={navigationHref(pageGraph, item.target)}>
                  {item.label}
                </platform.Link>
              </li>
            ))}
          </ul>
        </nav>
        {/* Placed unconditionally: it renders nothing when search is disabled. */}
        <platform.Search />
        {pageGraph.navigation.primaryAction === undefined ? null : (
          <platform.Link
            href={navigationHref(
              pageGraph,
              pageGraph.navigation.primaryAction.target,
            )}
          >
            {pageGraph.navigation.primaryAction.label}
          </platform.Link>
        )}
      </header>
      <main>
        <h1>{page.title}</h1>
        {children}
      </main>
      <footer>
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
      </footer>
    </div>
  );
}
