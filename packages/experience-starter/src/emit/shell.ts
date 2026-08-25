import type { ResolvedDesign } from "../decisions.js";
import type { InteractionPlan } from "../interaction-decisions.js";
import type { ClientScale } from "../scale.js";
import { titleCase } from "./content.js";

/**
 * Emits the client's shared chrome: palette binding, header, footer.
 *
 * Deliberately thin. Header, footer and the palette are the only things every
 * route shares — a shared body shell is exactly what makes a multi-page site
 * read as one repeated template, so each route composes its own body.
 */
export function emitShell(
  design: ResolvedDesign,
  plan: InteractionPlan,
  scale: ClientScale,
): string {
  const { ns, brief } = design;
  return `import type { CSSProperties, ReactNode } from "react";
import {
${scale.expandedNavigation ? "  childPages,\n" : ""}  navigationHref,
  type ClientExperienceRouteProps,${
    scale.expandedNavigation
      ? "\n  type RuntimePageDefinition,\n  type RuntimeProjectCollection,"
      : ""
  }
  type RuntimePageGraph,
  type RuntimeWebsiteProfileContent,
} from "@proportion/client-experience";

${plan.usesMenuMotion ? 'import { Menu } from "./Menu";\n' : ""}import { COPY } from "../content/site-content";
import "../styles/site.css";

type Platform = ClientExperienceRouteProps["platform"];

interface BrandStyle extends CSSProperties {
  readonly "--accent"?: string;
  readonly "--accent-contrast"?: string;
  readonly "--surface"?: string;
  readonly "--ink"?: string;
}

/**
 * The palette comes from the client's validated \`profile.brand\`, not from a
 * value typed into the stylesheet. If the configured accent changes in the
 * client definition, the site follows without touching this source.
 */
function brandStyle(profile: RuntimeWebsiteProfileContent): BrandStyle {
  return {
    "--accent": profile.brand.accentColor,
    "--accent-contrast": profile.brand.accentContrastColor,
    "--surface": profile.brand.surfaceColor,
    "--ink": profile.brand.textColor,
  };
}

function Navigation({
  pageGraph,
${scale.expandedNavigation ? "  profile,\n  projects,\n" : ""}  platform,
  currentPageId,
}: {
  readonly pageGraph: RuntimePageGraph;
${scale.expandedNavigation ? "  readonly profile: RuntimeWebsiteProfileContent;\n  readonly projects: RuntimeProjectCollection;\n" : ""}  readonly platform: Platform;
  readonly currentPageId?: string | undefined;
}) {
  return (
    <nav aria-label="Primary" className="${ns}-nav">
      <ul>
        {pageGraph.navigation.primary.map((item) => {
          const current =
            item.target.kind === "ROUTE" && item.target.pageId === currentPageId;
${
  scale.expandedNavigation
    ? `          const children =
            item.target.kind === "ROUTE"
              ? panelPages(pageGraph, projects, item.target.pageId)
              : [];
          if (children.length > 0) {
            return (
              <li key={item.navigationId}>
                <NavigationSection
                  currentPageId={currentPageId}
                  children_={children}
                  href={navigationHref(pageGraph, item.target)}
                  item={item}
                  platform={platform}
                  profile={profile}
                />
              </li>
            );
          }
`
    : ""
}          return (
            <li key={item.navigationId}>
              <platform.Link
                href={navigationHref(pageGraph, item.target)}
                {...(current
                  ? { "aria-current": "page" as const, "data-current": "true" }
                  : {})}
              >
                {item.label}
              </platform.Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}${
  scale.expandedNavigation
    ? `

/**
 * How many entries a panel will hold before it stops being a selection.
 *
 * Past this the panel is a list of everything, which the section's own page
 * already is and does better. The overflow is not truncated silently: the panel
 * always carries a link to the whole set.
 */
const NAVIGATION_PANEL_LIMIT = 8;

/**
 * The pages a panel should offer, which is not the same as the pages that exist.
 *
 * A project archive belongs in the archive. Fifty job links inside a dropdown is
 * the failure this rule exists to prevent: it is slow, unusable on a phone, and
 * it answers a question — "have you done my job near me?" — that the filtered
 * archive answers properly. So a projects panel offers the records the agency
 * selected, and nothing if none were selected.
 */
function panelPages(
  graph: RuntimePageGraph,
  projects: RuntimeProjectCollection,
  pageId: string,
): readonly RuntimePageDefinition[] {
  const children = childPages(graph, pageId);
  const featured = new Set(
    projects.projects.filter((project) => project.featured).map(({ projectId }) => projectId),
  );
  const selected = children.filter(
    (page) => page.content.kind !== "PROJECT" || featured.has(page.content.projectId),
  );
  return selected.slice(0, NAVIGATION_PANEL_LIMIT);
}

/**
 * A primary destination that owns pages, and the pages it owns.
 *
 * This is a **disclosure, not a menu**, and the difference is the whole design.
 * A menu implies application semantics, arrow-key traversal and an Escape
 * contract; a disclosure is a control that shows and hides content, which is
 * what this actually is. Native \`<details>\` gives the expanded state to
 * assistive technology, opens on Enter and Space, and — the part that matters
 * most on a phone — never opens on hover, so there is no destination reachable
 * only by a pointer and no panel that closes faster than a person can cross it.
 *
 * The trigger and the destination are deliberately two controls. A parent that
 * both navigates and expands has to guess which one a tap meant, and it guesses
 * wrong on touch. The summary expands; the first link inside the panel goes to
 * the section's own page.
 *
 * The children come from the page graph's \`parentPageId\`, so this list and
 * the site cannot disagree. Nothing here is authored twice.
 */
function NavigationSection({
  children_,
  currentPageId,
  href,
  item,
  platform,
  profile,
}: {
  readonly children_: readonly RuntimePageDefinition[];
  readonly currentPageId?: string | undefined;
  readonly href: string;
  readonly item: RuntimePageGraph["navigation"]["primary"][number];
  readonly platform: Platform;
  readonly profile: RuntimeWebsiteProfileContent;
}) {
  const serviceSections = profile.sections.filter(
    (section) => section.type === "SERVICES",
  );
  const groups = serviceSections.flatMap((section) => section.groups);
  const serviceGroup = new Map(
    serviceSections
      .flatMap((section) => section.items)
      .flatMap((service) =>
        service.serviceId === undefined || service.groupId === undefined
          ? []
          : [[service.serviceId, service.groupId] as const],
      ),
  );
  const groupOf = (page: RuntimePageDefinition) =>
    page.content.kind === "SERVICE"
      ? serviceGroup.get(page.content.serviceId)
      : undefined;
  /*
   * Service groups describe services. A section whose children are records has
   * no groups, and inheriting the service vocabulary would file every job under
   * a heading that means nothing about it.
   */
  const grouped =
    groups.length > 0 &&
    children_.some((page) => page.content.kind === "SERVICE");
  const runs = !grouped
      ? [{ key: item.navigationId, title: undefined, pages: children_ }]
      : [
          ...groups.map((group) => ({
            key: group.groupId,
            title: group.title,
            pages: children_.filter((page) => groupOf(page) === group.groupId),
          })),
          ...(children_.some((page) => groupOf(page) === undefined)
            ? [
                {
                  key: "other",
                  title: "Also available",
                  pages: children_.filter((page) => groupOf(page) === undefined),
                },
              ]
            : []),
        ];

  return (
    <details className="${ns}-nav-section">
      <summary className="${ns}-nav-summary">{item.label}</summary>
      <div className="${ns}-nav-panel">
        <p className="${ns}-nav-all">
          <platform.Link href={href}>
            <span className="${ns}-onward">All {item.label.toLowerCase()}</span>
          </platform.Link>
        </p>
        {runs
          .filter((run) => run.pages.length > 0)
          .map((run) => (
            <div key={run.key}>
              {run.title === undefined ? null : (
                <p className="${ns}-nav-group">{run.title}</p>
              )}
              <ul>
                {run.pages.map((page) => (
                  <li key={page.pageId}>
                    <platform.Link
                      href={page.path}
                      {...(page.pageId === currentPageId
                        ? { "aria-current": "page" as const, "data-current": "true" }
                        : {})}
                    >
                      {page.title}
                    </platform.Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </details>
  );
}`
    : ""
}

function Header({
  site,
  pageGraph,
${scale.expandedNavigation ? "  profile,\n  projects,\n" : ""}  platform,
  currentPageId,
}: {
  readonly site: ClientExperienceRouteProps["site"];
  readonly pageGraph: RuntimePageGraph;
${scale.expandedNavigation ? "  readonly profile: RuntimeWebsiteProfileContent;\n  readonly projects: RuntimeProjectCollection;\n" : ""}  readonly platform: Platform;
  readonly currentPageId?: string | undefined;
}) {
  const action = pageGraph.navigation.primaryAction;
  const navigation = (
    <Navigation
      currentPageId={currentPageId}
      pageGraph={pageGraph}
      platform={platform}
${scale.expandedNavigation ? "      profile={profile}\n      projects={projects}\n" : ""}    />
  );

  return (
    <header className="${ns}-header">
      <div className="${ns}-shell ${ns}-header-inner">
        <platform.Link href="/">
          <span className="${ns}-wordmark">{site.businessName}</span>
        </platform.Link>

        {/*
          * One navigation, written once. platform.Disclosure renders it twice —
          * a closed <details> hides its content regardless of CSS, so a single
          * instance cannot serve both widths — and keeps exactly one of the two
          * in the accessibility tree. This client chooses where the swap
          * happens, in site.css.
          */}
        ${plan.usesMenuMotion ? "<Menu>\n        " : ""}<platform.Disclosure
          className="${ns}-menu"
          panelClassName="${ns}-menu-panel"
          staticClassName="${ns}-nav-static"
          summary={${JSON.stringify(brief.navigation.menuLabel)}}
          summaryClassName="${ns}-menu-toggle"
        >
          {navigation}
        </platform.Disclosure>${plan.usesMenuMotion ? "\n        </Menu>" : ""}

        <div className="${ns}-header-actions">
          <platform.Search />
          {action === undefined ? null : (
            <platform.Link href={navigationHref(pageGraph, action.target)}>
              <span className="${ns}-action">{action.label}</span>
            </platform.Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer({
  site,
  pageGraph,
  platform,
  disclosure,
}: {
  readonly site: ClientExperienceRouteProps["site"];
  readonly pageGraph: RuntimePageGraph;
  readonly platform: Platform;
  readonly disclosure: string | undefined;
}) {
  return (
    <footer className="${ns}-footer">
      <div className="${ns}-shell">
        <div className="${ns}-footer-grid">
          <p className="${ns}-footer-statement">{COPY.footerStatement}</p>

          <nav aria-label="Footer">
            <h2>Pages</h2>
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

          <div>
            <h2>Enquiries</h2>
            <p className="${ns}-meta">{COPY.footerEnquiries}</p>
          </div>
        </div>

        <div className="${ns}-colophon">
          <p>{disclosure}</p>
          <p>{site.businessName}</p>
        </div>
      </div>
    </footer>
  );
}

/** Shared chrome for every ${titleCase(brief.experienceId)} route. */
export function Shell({
  site,
  pageGraph,
  profile,
${scale.expandedNavigation ? "  projects,\n" : ""}  platform,
  currentPageId,
  children,
}: {
  readonly site: ClientExperienceRouteProps["site"];
  readonly pageGraph: RuntimePageGraph;
  readonly profile: RuntimeWebsiteProfileContent;
${scale.expandedNavigation ? "  readonly projects: RuntimeProjectCollection;\n" : ""}  readonly platform: Platform;
  readonly currentPageId?: string | undefined;
  readonly children: ReactNode;
}) {
  const disclosure = profile.sections.find(
    (section) => section.type === "TRUST_SIGNALS",
  )?.disclaimer;

  return (
    <div className="${ns}" style={brandStyle(profile)}>
      <platform.SkipLink className="${ns}-skip" />
      <Header
        currentPageId={currentPageId}
        pageGraph={pageGraph}
        platform={platform}
${scale.expandedNavigation ? "        profile={profile}\n        projects={projects}\n" : ""}        site={site}
      />
      <platform.Main>{children}</platform.Main>
      <Footer
        disclosure={disclosure}
        pageGraph={pageGraph}
        platform={platform}
        site={site}
      />
    </div>
  );
}

/** Convenience wrapper for the common \`Shell\` call inside a route. */
export function RouteShell({
  props,
  children,
}: {
  readonly props: ClientExperienceRouteProps;
  readonly children: ReactNode;
}) {
  return (
    <Shell
      currentPageId={props.page.pageId}
      pageGraph={props.pageGraph}
      platform={props.platform}
      profile={props.profile}
${scale.expandedNavigation ? "      projects={props.projects}\n" : ""}      site={props.site}
    >
      {children}
    </Shell>
  );
}
`;
}
