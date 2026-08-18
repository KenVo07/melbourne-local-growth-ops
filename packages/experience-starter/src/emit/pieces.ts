import type { ResolvedDesign } from "../decisions.js";
import type { InteractionPlan } from "../interaction-decisions.js";
import { titleCase } from "./content.js";

/**
 * Emits the client's own small set of presentation pieces.
 *
 * These are client-local components in the client's repository. They are not a
 * shared component library: the generated site imports them by relative path,
 * they carry this client's class names, and an operator is free to rewrite or
 * delete any of them without the Factory having an opinion.
 */
export function emitPieces(design: ResolvedDesign, plan: InteractionPlan): string {
  const { ns } = design;
  const revealImport = plan.usesReveal
      ? `\nimport { Reveal } from "./Reveal";`
      : "";
  const revealExport = plan.usesReveal
      ? `
/**
 * A composition that arrives rather than simply being there. Wrapping is opt-in
 * per placement, so a route that wants none pays nothing: the helper is only in
 * the bundle if a route imports it.
 *
 * \`as\` names what is arriving, not how it should move. Prose lifts the short
 * distance a reader's eye was travelling anyway; a photograph is already where
 * it belongs, so it resolves where it stands instead of sliding in. The
 * stylesheet holds both readings; this only says which one applies.
 */
export function Arrive({
  children,
  className,
  as,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly as?: "media" | undefined;
}) {
  return (
    <Reveal as={as} className={className}>
      {children}
    </Reveal>
  );
}
`
      : "";

  return `import type { ReactNode } from "react";
import type {
  ClientExperienceResolvedMedia,
  ClientExperienceRouteProps,
  RuntimeMediaReference,
  RuntimeMediaRole,
} from "@proportion/client-experience";

import { PROVENANCE, type SitePhotograph } from "../content/site-content";${revealImport}

type Platform = ClientExperienceRouteProps["platform"];

export type PlateRatio = "wide" | "tall" | "square" | "panorama" | "natural";

/**
 * A framed photograph.
 *
 * The Platform guarantees the image never overflows its box and resolves the
 * focal point per viewport. This component owns the framing: the ratio, the
 * corner and the provenance line.
 */
export function Plate({
  platform,
  reference,
  ratio = "wide",
  sizes,
  caption = PROVENANCE,
  priority = false,
  className,
}: {
  readonly platform: Platform;
  readonly reference: RuntimeMediaReference;
  readonly ratio?: PlateRatio;
  readonly sizes: string;
  readonly caption?: string | undefined;
  readonly priority?: boolean;
  readonly className?: string | undefined;
}) {
  return (
    <figure
      className={className === undefined ? "${ns}-plate" : \`${ns}-plate \${className}\`}
      data-ratio={ratio}
    >
      <platform.Image priority={priority} reference={reference} sizes={sizes} />
      {caption === undefined ? null : <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/**
 * Builds a media reference for a site-level photograph the client definition
 * does not attach to a project. Aspect stays descriptive; the CSS frame decides
 * the shape.
 */
export function siteMedia(
  photograph: SitePhotograph,
  role: Exclude<RuntimeMediaRole, "DECORATIVE"> = "CONTENT",
): RuntimeMediaReference {
  return {
    assetId: photograph.assetId,
    role,
    decorative: false,
    alt: photograph.alt,
    presentation: {
      aspect: "LANDSCAPE",
      fit: "COVER",
      focalPoint: photograph.focal,
      ...(photograph.mobileFocal === undefined
        ? {}
        : { mobile: { focalPoint: photograph.mobileFocal } }),
    },
  };
}

/**
 * Chooses a frame from the asset's real orientation.
 *
 * A fixed media set mixes portrait and landscape sources. Forcing one ratio
 * across a register crops a tall interior to a strip and loses the room, so the
 * portrait sources take the taller frame. The register still reads as one
 * rhythm because the column width does not change.
 */
export function ratioFor(
  media: readonly ClientExperienceResolvedMedia[],
  assetId: string,
  frames: { readonly portrait: PlateRatio; readonly landscape: PlateRatio },
): PlateRatio {
  const resolved = media.find(
    (candidate) => candidate.reference.assetId === assetId,
  );
  if (resolved === undefined) return frames.landscape;
  return resolved.height > resolved.width ? frames.portrait : frames.landscape;
}

/** A section label. Small, tracked, and never mistakable for a heading. */
export function Label({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <p
      className={
        className === undefined ? "${ns}-label" : \`${ns}-label \${className}\`
      }
    >
      {children}
    </p>
  );
}

/**
 * The standard page opening.
 *
 * The supporting column is pushed down by exactly one label height, so its first
 * line sits on the heading's first baseline instead of floating above it. That
 * one rule is the difference between "top aligned" and "optically settled".
 */
export function PageHead({
  label,
  title,
  lede,
  aside,
  id,
}: {
  readonly label: string;
  readonly title: ReactNode;
  readonly lede?: ReactNode;
  readonly aside?: ReactNode;
  readonly id?: string | undefined;
}) {
  return (
    <section className="${ns}-shell ${ns}-head">
      <div className="${ns}-head-main">
        <Label>{label}</Label>
        <h1 className="${ns}-page-title" {...(id === undefined ? {} : { id })}>
          {title}
        </h1>
      </div>
      <div className="${ns}-head-aside">
        {lede === undefined ? null : <p className="${ns}-lede">{lede}</p>}
        {aside}
      </div>
    </section>
  );
}

/**
 * The closing step, used on every route that is not itself the contact page.
 * One consistent next action across the site is a conversion decision, not
 * repetition.
 */
export function NextStep({
  platform,
  label,
  heading,
  body,
  primary,
  secondary,
}: {
  readonly platform: Platform;
  readonly label: string;
  readonly heading: string;
  readonly body: string;
  readonly primary: string;
  readonly secondary: string;
}) {
  return (
    <section className="${ns}-shell ${ns}-preview">
      <div>
        <Label>{label}</Label>
        <p className="${ns}-section-title" style={{ marginTop: "var(--stack-tight)" }}>
          {heading}
        </p>
      </div>
      <div className="${ns}-preview-aside">
        <p className="${ns}-lede">{body}</p>
        <div className="${ns}-actions" style={{ marginTop: "var(--stack-loose)" }}>
          <platform.Link href="/contact">
            <span className="${ns}-action">{primary}</span>
          </platform.Link>
          <platform.Link href="/projects">
            <span className="${ns}-action ${ns}-action-quiet">{secondary}</span>
          </platform.Link>
        </div>
      </div>
    </section>
  );
}
${revealExport}`;
}

export function piecesHeader(design: ResolvedDesign): string {
  return `${titleCase(design.brief.experienceId)}`;
}
