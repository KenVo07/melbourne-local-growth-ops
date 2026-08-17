import Image from "next/image";

// Safe responsive mechanics for every validated client image. Zero-specificity,
// so authored composition overrides it freely.
import "./platform-media.css";
// Disclosure and truthful-state mechanics. Zero-specificity, same contract.
import "./platform-mechanics.css";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import type {
  RuntimeExternalAction,
  RuntimeMediaReference,
} from "../runtime-types";
import { FoundationSearch } from "../rendering/search/FoundationSearch";
import type {
  ClientExperienceActionProps,
  ClientExperienceDisclosureProps,
  ClientExperienceImageProps,
  ClientExperienceLinkProps,
  ClientExperiencePlatformComponents,
  ClientExperienceRegionProps,
  ClientExperienceResolvedMedia,
  ClientExperienceMainProps,
  ClientExperienceSearchProps,
  ClientExperienceSkipLinkProps,
} from "./contract";

interface PlatformMediaStyle extends CSSProperties {
  readonly "--platform-media-fit"?: string;
  readonly "--platform-media-position-desktop"?: string;
  readonly "--platform-media-position-tablet"?: string;
  readonly "--platform-media-position-mobile"?: string;
}

export interface CreateClientExperiencePlatformComponentsOptions {
  /** Every media reference reachable from this route, already resolved. */
  readonly media: readonly ClientExperienceResolvedMedia[];
  /**
   * Renders one already-resolved Platform region. This callback stays
   * Kernel-owned so client source never receives raw module or connector data.
   */
  readonly renderRegion: (regionId: string) => ReactNode;
  readonly knownRegionIds: ReadonlySet<string>;
  /** Validated external actions declared by the profile, keyed by action ID. */
  readonly actions: ReadonlyMap<string, RuntimeExternalAction>;
  /** Resolved Foundation Search state for this client. */
  readonly search: Readonly<{ enabled: boolean; businessName: string }>;
}

/**
 * Creates the narrow component surface exposed to authored client routes.
 *
 * Instantiate once per route render: duplicate-region tracking must be local to
 * that render and never shared across requests.
 */
export function createClientExperiencePlatformComponents(
  options: CreateClientExperiencePlatformComponentsOptions,
): ClientExperiencePlatformComponents {
  const placedRegions = new Set<string>();
  const mediaByAssetId = new Map(
    options.media.map((resolved) => [resolved.reference.assetId, resolved]),
  );

  function PlatformLink({
    href,
    children,
    className,
    prefetch,
    "aria-label": ariaLabel,
  }: ClientExperienceLinkProps) {
    assertInternalHref(href);
    return (
      <Link
        aria-label={ariaLabel}
        className={className}
        href={href}
        {...(prefetch === undefined ? {} : { prefetch })}
      >
        {children}
      </Link>
    );
  }

  function PlatformImage({
    reference,
    className,
    sizes,
    priority = false,
  }: ClientExperienceImageProps) {
    if (sizes.trim().length === 0) {
      throw new Error(
        `Client media "${reference.assetId}" requires a non-empty sizes value describing its rendered layout.`,
      );
    }
    const resolved = mediaByAssetId.get(reference.assetId);
    if (resolved === undefined) {
      throw new Error(
        `Client media "${reference.assetId}" is not part of this route's validated media set.`,
      );
    }
    /*
     * Presentation is published as custom properties rather than as inline
     * `object-fit` / `object-position`. Inline styles outrank every stylesheet,
     * which would both freeze the desktop focal point at all viewports and make
     * the values impossible for authored CSS to override. platform-media.css
     * resolves them per viewport tier at zero specificity.
     */
    const style: PlatformMediaStyle = {
      "--platform-media-fit": reference.presentation.fit.toLowerCase(),
      "--platform-media-position-desktop": mediaObjectPosition(
        reference,
        "DESKTOP",
      ),
      "--platform-media-position-tablet": mediaObjectPosition(
        reference,
        "TABLET",
      ),
      "--platform-media-position-mobile": mediaObjectPosition(
        reference,
        "MOBILE",
      ),
    };
    return (
      <Image
        alt={reference.decorative ? "" : reference.alt}
        aria-hidden={reference.decorative ? true : undefined}
        className={className}
        data-platform-media-aspect={reference.presentation.aspect.toLowerCase()}
        data-platform-media-fit={reference.presentation.fit.toLowerCase()}
        data-platform-media-role={reference.role.toLowerCase()}
        height={resolved.height}
        priority={priority}
        sizes={sizes}
        src={resolved.src}
        style={style}
        width={resolved.width}
      />
    );
  }

  function PlatformRegion({
    regionId,
    className,
  }: ClientExperienceRegionProps) {
    if (!options.knownRegionIds.has(regionId)) {
      throw new Error(
        `Client experience requested unknown region "${regionId}".`,
      );
    }
    if (placedRegions.has(regionId)) {
      throw new Error(
        `Client experience placed region "${regionId}" more than once on one route.`,
      );
    }
    placedRegions.add(regionId);
    return (
      <div className={className} data-platform-region={regionId}>
        {options.renderRegion(regionId)}
      </div>
    );
  }

  /**
   * Renders one validated external action. A NOT_CONFIGURED action renders its
   * truthful message rather than a dead link or a hidden control, matching the
   * legacy shell's behavior.
   */
  function PlatformAction({ actionId, className }: ClientExperienceActionProps) {
    const action = options.actions.get(actionId);
    if (action === undefined) {
      throw new Error(
        `Client experience requested unknown external action "${actionId}".`,
      );
    }
    if (action.state === "CONFIGURED" && action.href !== undefined) {
      return (
        <a
          className={className}
          data-action-kind={action.kind}
          data-action-state="CONFIGURED"
          data-platform-action={action.actionId}
          href={action.href}
        >
          {action.label}
        </a>
      );
    }
    /*
     * The label and the message are two separate statements. They were emitted
     * as bare inline nodes, which read as one run-on sentence until the client
     * wrote a rule — a rule every client had to write. Both now carry a
     * mechanical hook that platform-mechanics.css sets to block flow at zero
     * specificity. The Platform still chooses no colour, size or spacing, so the
     * client styles the semantic state rather than inheriting a design.
     */
    return (
      <div
        className={className}
        data-action-kind={action.kind}
        data-action-state="NOT_CONFIGURED"
        data-platform-action={action.actionId}
        role="status"
      >
        <strong data-platform-action-label="">{action.label}</strong>
        {action.message === undefined ? null : (
          <span data-platform-action-message="">{action.message}</span>
        )}
      </div>
    );
  }

  /*
   * One source of truth for the disclosed content, rendered twice, with exactly
   * one instance live. See ClientExperienceDisclosureProps for why duplication
   * is unavoidable rather than lazy.
   */
  function PlatformDisclosure({
    summary,
    children,
    className,
    summaryClassName,
    panelClassName,
    staticClassName,
  }: ClientExperienceDisclosureProps) {
    return (
      <>
        <div
          {...(staticClassName === undefined ? {} : { className: staticClassName })}
          data-platform-disclosure="static"
        >
          {children}
        </div>
        <details
          {...(className === undefined ? {} : { className })}
          data-platform-disclosure="compact"
        >
          <summary
            {...(summaryClassName === undefined
              ? {}
              : { className: summaryClassName })}
          >
            {summary}
          </summary>
          <div
            {...(panelClassName === undefined ? {} : { className: panelClassName })}
            data-platform-disclosure-panel=""
          >
            {children}
          </div>
        </details>
      </>
    );
  }

  /**
   * Renders nothing when search resolved to disabled, so an authored route can
   * place it unconditionally without a disabled site paying any search cost.
   */
  function PlatformSearch({ className }: ClientExperienceSearchProps) {
    if (!options.search.enabled) return null;
    return (
      <div className={className} data-platform-search="">
        <FoundationSearch businessName={options.search.businessName} />
      </div>
    );
  }

  /*
   * The main landmark and its skip target are Kernel-owned and share one id, so
   * an authored route cannot ship a skip link that points nowhere, or a landmark
   * nothing can reach. The route decides where they go; it does not get to
   * disagree about what they are.
   */
  const mainElementId = "client-main";

  function PlatformMain({ className, children }: ClientExperienceMainProps) {
    return (
      <main
        {...(className === undefined ? {} : { className })}
        id={mainElementId}
        tabIndex={-1}
      >
        {children}
      </main>
    );
  }

  function PlatformSkipLink({ children, className }: ClientExperienceSkipLinkProps) {
    return (
      <a
        {...(className === undefined ? {} : { className })}
        data-platform-skip-link=""
        href={`#${mainElementId}`}
      >
        {children ?? "Skip to content"}
      </a>
    );
  }

  return Object.freeze({
    Link: PlatformLink,
    Image: PlatformImage,
    Region: PlatformRegion,
    Action: PlatformAction,
    Search: PlatformSearch,
    Disclosure: PlatformDisclosure,
    Main: PlatformMain,
    SkipLink: PlatformSkipLink,
  });
}

/**
 * Converts a client-owned focal point into a CSS object-position. Mirrors
 * site-core's `mediaObjectPosition` against the portable runtime types so the
 * artifact carries no workspace dependency.
 */
export function mediaObjectPosition(
  reference: RuntimeMediaReference,
  viewport: "MOBILE" | "TABLET" | "DESKTOP",
): string {
  const override =
    viewport === "MOBILE"
      ? reference.presentation.mobile
      : viewport === "TABLET"
        ? reference.presentation.tablet
        : undefined;
  const focalPoint = override?.focalPoint ?? reference.presentation.focalPoint;
  return focalPoint === undefined
    ? "50% 50%"
    : `${formatPercentage(focalPoint.x)} ${formatPercentage(focalPoint.y)}`;
}

function formatPercentage(value: number): string {
  return `${Math.round(value * 10_000) / 100}%`;
}

function assertInternalHref(href: string): void {
  if (
    href === "/" ||
    /^#[a-z][a-z0-9-]*$/.test(href) ||
    /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?(?:#[a-z][a-z0-9-]*)?$/.test(
      href,
    )
  ) {
    return;
  }
  throw new Error(
    `PlatformLink accepts only validated internal route or anchor hrefs. Received "${href}". Use platform.Action for a validated external action.`,
  );
}
