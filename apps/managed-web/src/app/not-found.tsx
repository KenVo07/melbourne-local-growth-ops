import Link from "next/link";

import { isAuthoredClientWebsite } from "../client-experience/load-client-experience";
import { authoredClientExperienceContext } from "../client-experience/load-client-experience";
import { renderAuthoredNotFound } from "../client-experience/render-authored-page";
import { composeCurrentManagedWebsite } from "../managed-website";

/**
 * Intentional not-found page.
 *
 * It keeps the site's own identity and offers real recovery through the
 * client's validated primary navigation. It deliberately reveals nothing about
 * the requested path, the route table or any internal error: a 404 is a normal
 * visitor outcome, not a diagnostic surface.
 */
export default function NotFound() {
  if (isAuthoredClientWebsite()) {
    // An authored 404 keeps a mistyped URL inside the client's own art
    // direction instead of dropping the visitor onto a differently styled page.
    const authored = renderAuthoredNotFound();
    if (authored !== undefined) {
      return authored;
    }
  }
  const { businessName } = composeCurrentManagedWebsite().configuration.display;
  const recovery = isAuthoredClientWebsite()
    ? authoredRecoveryLinks()
    : [{ href: "/", label: "Return to the home page" }];

  return (
    <main className="site-not-found" data-route-state="not-found">
      <h1>Page not found</h1>
      <p>
        That page is not part of the {businessName} website. It may have been
        moved or the address may be mistyped.
      </p>
      <nav aria-label="Recovery navigation">
        <ul>
          {recovery.map(({ href, label }) => (
            <li key={href}>
              <Link href={href}>{label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}

function authoredRecoveryLinks(): readonly {
  href: string;
  label: string;
}[] {
  const context = authoredClientExperienceContext();
  const pagesById = new Map(
    context.pages.map((page) => [page.pageId, page] as const),
  );
  return context.projection.pageGraph.navigation.primary
    .map((item) => {
      const page = pagesById.get(item.target.pageId);
      return page === undefined
        ? undefined
        : { href: page.path, label: item.label };
    })
    .filter(
      (link): link is { href: string; label: string } => link !== undefined,
    );
}
