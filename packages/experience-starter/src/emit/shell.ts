import type { ResolvedDesign } from "../decisions.js";
import type { InteractionPlan } from "../interaction-decisions.js";
import { titleCase } from "./content.js";

/**
 * Emits the client's shared chrome: palette binding, header, footer.
 *
 * Deliberately thin. Header, footer and the palette are the only things every
 * route shares — a shared body shell is exactly what makes a multi-page site
 * read as one repeated template, so each route composes its own body.
 */
export function emitShell(design: ResolvedDesign, plan: InteractionPlan): string {
  const { ns, brief } = design;
  return `import type { CSSProperties, ReactNode } from "react";
import {
  navigationHref,
  type ClientExperienceRouteProps,
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
  platform,
  currentPageId,
}: {
  readonly pageGraph: RuntimePageGraph;
  readonly platform: Platform;
  readonly currentPageId?: string | undefined;
}) {
  return (
    <nav aria-label="Primary" className="${ns}-nav">
      <ul>
        {pageGraph.navigation.primary.map((item) => {
          const current =
            item.target.kind === "ROUTE" && item.target.pageId === currentPageId;
          return (
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
}

function Header({
  site,
  pageGraph,
  platform,
  currentPageId,
}: {
  readonly site: ClientExperienceRouteProps["site"];
  readonly pageGraph: RuntimePageGraph;
  readonly platform: Platform;
  readonly currentPageId?: string | undefined;
}) {
  const action = pageGraph.navigation.primaryAction;
  const navigation = (
    <Navigation
      currentPageId={currentPageId}
      pageGraph={pageGraph}
      platform={platform}
    />
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
  platform,
  currentPageId,
  children,
}: {
  readonly site: ClientExperienceRouteProps["site"];
  readonly pageGraph: RuntimePageGraph;
  readonly profile: RuntimeWebsiteProfileContent;
  readonly platform: Platform;
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
        site={site}
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
      site={props.site}
    >
      {children}
    </Shell>
  );
}
`;
}
