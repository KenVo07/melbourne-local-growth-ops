import type { StarterBrief, StarterTypeFamily } from "./brief.js";

/**
 * Resolves the brief's design decisions into the concrete values the emitters
 * write into client-local source.
 *
 * Everything here is arithmetic on a design decision, never a lookup into a
 * finished theme. Two briefs that differ in ratio, weight, density, ground or
 * media scale produce different numbers throughout, which is what keeps two
 * clients on one Profile from converging on a single look.
 */

export interface ResolvedType {
  readonly displayStack: string;
  readonly textStack: string;
  readonly displayWeight: number;
  readonly displayTracking: string;
  readonly displayLeading: string;
  readonly bodyLeading: string;
  readonly measure: string;
  readonly emphasis: StarterBrief["typography"]["emphasis"];
  readonly label: {
    readonly transform: string;
    readonly tracking: string;
    readonly weight: number;
    readonly size: string;
  };
  /** Responsive `clamp()` expressions, largest first. */
  readonly hero: string;
  readonly pageTitle: string;
  readonly sectionTitle: string;
  readonly itemTitle: string;
  readonly lede: string;
  readonly body: string;
  readonly small: string;
  /** The numeric rem maxima, kept so emitters can reason about relationships. */
  readonly scale: {
    readonly hero: number;
    readonly pageTitle: number;
    readonly sectionTitle: number;
    readonly itemTitle: number;
  };
}

export interface ResolvedSpace {
  readonly unit: string;
  readonly shell: string;
  readonly inset: string;
  readonly gutter: string;
  /** Section block padding, in units, at each viewport tier. */
  readonly section: { readonly wide: number; readonly mid: number; readonly narrow: number };
  readonly stack: { readonly tight: number; readonly normal: number; readonly loose: number };
}

export interface ResolvedColour {
  readonly paper: string;
  readonly inkMuted: string;
  readonly inkFaint: string;
  readonly rule: string;
  readonly ruleSoft: string;
  /** Ground contrast ratios actually achieved, recorded for the report. */
  readonly contrastReport: readonly {
    readonly token: string;
    readonly against: string;
    readonly ratio: number;
  }[];
}

export interface ResolvedMedia {
  readonly ratios: {
    readonly wide: string;
    readonly tall: string;
    readonly square: string;
    readonly panorama: string;
  };
  readonly mobileRatios: {
    readonly wide: string;
    readonly panorama: string;
  };
  readonly radius: string;
  readonly caption: StarterBrief["media"]["caption"];
  /** Fraction of a split composition the media column occupies. */
  readonly splitWeight: number;
}

export interface ResolvedBreakpoints {
  /** Where a two-column composition becomes one. */
  readonly wide: string;
  /** Where navigation collapses and mobile art direction begins. */
  readonly mid: string;
  /** The small-phone stress tier. */
  readonly narrow: string;
}

export interface ResolvedDesign {
  readonly ns: string;
  /** The validated client Profile, so emitted source can restate it truthfully. */
  readonly profile: string;
  readonly type: ResolvedType;
  readonly space: ResolvedSpace;
  readonly colour: ResolvedColour;
  readonly media: ResolvedMedia;
  readonly breakpoints: ResolvedBreakpoints;
  readonly brief: StarterBrief;
}

const familyStacks: Readonly<Record<StarterTypeFamily, string>> = {
  HUMANIST_SANS:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  GEOMETRIC_SANS:
    '"Avenir Next", Avenir, "Century Gothic", "URW Gothic", Futura, ui-sans-serif, system-ui, sans-serif',
  GROTESQUE_SANS:
    '"Helvetica Neue", Helvetica, "Inter", "Arial Nova", Arial, ui-sans-serif, system-ui, sans-serif',
  TRANSITIONAL_SERIF:
    '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, ui-serif, serif',
  MODERN_SERIF:
    '"Didot", "Bodoni MT", "Playfair Display", "Times New Roman", ui-serif, Georgia, serif',
};

/**
 * Page grounds. Each is a considered neutral world rather than a tint of the
 * client's accent, because a ground taken from the brand is what makes every
 * site in a Profile read as the same site with a hue rotation.
 */
const grounds: Readonly<
  Record<
    StarterBrief["colour"]["ground"],
    { paper: string; anchor: string; ruleMix: number }
  >
> = {
  WARM_PAPER: { paper: "#f2efe7", anchor: "#14201c", ruleMix: 0.22 },
  COOL_STONE: { paper: "#eef0ef", anchor: "#1b2124", ruleMix: 0.2 },
  MINERAL_CLAY: { paper: "#ece7df", anchor: "#241f19", ruleMix: 0.26 },
  NEUTRAL_LIGHT: { paper: "#f6f6f5", anchor: "#17181a", ruleMix: 0.18 },
  DEEP_INK: { paper: "#15181a", anchor: "#f2f3f1", ruleMix: 0.24 },
};

export interface ResolveDesignOptions {
  readonly brief: StarterBrief;
  /** The validated brand surface, used only to prove the neutral scale is legible on it. */
  readonly brandSurfaceColour: string;
  /** The validated client Profile identifier, e.g. CONTRACTOR. */
  readonly profile: string;
}

export function resolveDesign(options: ResolveDesignOptions): ResolvedDesign {
  const { brief } = options;
  return Object.freeze({
    ns: brief.namespace,
    profile: options.profile,
    type: resolveType(brief),
    space: resolveSpace(brief),
    colour: resolveColour(brief, options.brandSurfaceColour),
    media: resolveMedia(brief),
    breakpoints: resolveBreakpoints(brief),
    brief,
  });
}

/* ------------------------------------------------------------ typography */

/**
 * A modular scale with a responsive floor.
 *
 * Large type is clamped so it reaches its maximum at a 1440px viewport and
 * compresses on the way down; a display line and a body line therefore do not
 * compress at the same rate, which is what stops a small screen reading as a
 * shrunken desktop. The compression factor is looser for small steps because
 * body copy that scales with the viewport is unreadable.
 */
function resolveType(brief: StarterBrief): ResolvedType {
  const { typography } = brief;
  const step = (n: number) =>
    round(typography.baseSize * typography.scaleRatio ** n, 4);

  /*
   * A modular ratio compounds, and by the sixth step a ratio chosen for a
   * confident *hierarchy* has produced a 139px headline that owns six lines of a
   * two-column page. Each role therefore has a range it must land in: the ratio
   * still decides where inside that range a brief sits — and two briefs still
   * read differently — but no ratio can drive a display size past what the
   * composition can hold.
   */
  const hero = bounded(step(6), 2.4, 4.75);
  const pageTitle = bounded(step(5), 2, 3.8);
  const sectionTitle = bounded(step(4), 1.6, 2.8);
  const itemTitle = bounded(step(2), 1.2, 1.95);
  const lede = bounded(step(1), 1.1, 1.4);

  return Object.freeze({
    displayStack: familyStacks[typography.displayFamily],
    textStack: familyStacks[typography.textFamily],
    displayWeight: typography.displayWeight,
    displayTracking: `${round(typography.displayTracking, 4)}em`,
    displayLeading: String(round(typography.displayLeading, 3)),
    bodyLeading: String(round(typography.bodyLeading, 3)),
    measure: `${round(typography.measure, 2)}rem`,
    emphasis: typography.emphasis,
    label: {
      transform: typography.label.case === "UPPER" ? "uppercase" : "none",
      tracking: `${round(typography.label.tracking, 3)}em`,
      weight: typography.label.weight,
      size: `${round(typography.label.size, 3)}rem`,
    },
    hero: fluid(hero, 0.46),
    pageTitle: fluid(pageTitle, 0.52),
    sectionTitle: fluid(sectionTitle, 0.62),
    itemTitle: fluid(itemTitle, 0.78),
    lede: fluid(lede, 0.88),
    body: `${round(typography.baseSize, 4)}rem`,
    /*
     * One step down, but not a full modular step. A large ratio is a decision
     * about *display* hierarchy; applying it to the small end produces 12px
     * metadata, which is a legibility failure rather than a design.
     */
    small: `${round(typography.baseSize / (1 + (typography.scaleRatio - 1) * 0.55), 4)}rem`,
    scale: Object.freeze({ hero, pageTitle, sectionTitle, itemTitle }),
  });
}

function bounded(value: number, low: number, high: number): number {
  return round(Math.min(high, Math.max(low, value)), 4);
}

/**
 * `clamp(min, Xvw, max)` where X is chosen so the value reaches `max` at
 * 1440px (90rem) — 1vw is 0.9rem there, so X = max / 0.9.
 */
function fluid(maxRem: number, compression: number): string {
  const min = round(maxRem * compression, 4);
  const vw = round(maxRem / 0.9, 3);
  return `clamp(${min}rem, ${vw}vw, ${round(maxRem, 4)}rem)`;
}

/* ---------------------------------------------------------------- spacing */

const densityScale: Readonly<
  Record<
    StarterBrief["space"]["density"],
    { wide: number; mid: number; narrow: number }
  >
> = {
  COMPACT: { wide: 6, mid: 5, narrow: 4 },
  MEASURED: { wide: 8.5, mid: 6.5, narrow: 5 },
  EXPANSIVE: { wide: 9, mid: 7, narrow: 5.5 },
};

function resolveSpace(brief: StarterBrief): ResolvedSpace {
  const { space } = brief;
  const section = densityScale[space.density];
  const stackBase = space.density === "COMPACT" ? 0.85 : space.density === "EXPANSIVE" ? 1.25 : 1;
  return Object.freeze({
    unit: `${round(space.unit, 4)}rem`,
    shell: `${round(space.shell, 2)}rem`,
    inset: String(round(space.inset, 2)),
    gutter: String(round(space.gutter, 2)),
    section: Object.freeze(section),
    stack: Object.freeze({
      tight: round(1.5 * stackBase, 3),
      normal: round(3 * stackBase, 3),
      loose: round(5 * stackBase, 3),
    }),
  });
}

/* ----------------------------------------------------------------- colour */

/**
 * Derives the neutral scale from the ground and **proves it legible** before it
 * is written.
 *
 * Gate A2 lost a QA cycle to muted ink that failed WCAG AA at caption sizes on
 * the surface tone. That was arithmetic a person had to remember, so the
 * generator does it: each derived neutral is darkened toward the ground's anchor
 * until it clears 4.5:1 against *both* the ground and the validated brand
 * surface it may sit on. The brand colour is read as a constraint, never as a
 * colour source — nothing brand-derived is written into the stylesheet.
 */
function resolveColour(
  brief: StarterBrief,
  brandSurfaceColour: string,
): ResolvedColour {
  const ground = grounds[brief.colour.ground];
  const overrides = brief.neutralOverrides ?? {};
  const paper = overrides.paper ?? ground.paper;
  const backgrounds = [paper, brandSurfaceColour];

  /*
   * How much of the ground's dark anchor the neutrals carry. A crisp scale sits
   * closer to the anchor and separates harder; a soft one stays nearer the
   * ground. The faint tone always carries less anchor than the muted one — but
   * both are then pushed until they are legible, so "faint" never means
   * "unreadable".
   */
  const anchorMix = brief.colour.contrast === "CRISP" ? 0.72 : 0.62;
  /*
   * Two legibility floors rather than one. If both tones were merely pushed to
   * AA they would converge on the same colour and "faint" would be a token with
   * no design in it, so the muted tone is held at a genuinely stronger ratio and
   * the faint tone at the accessible minimum. The step between them is then real
   * and both are readable at caption size.
   */
  const inkMuted =
    overrides.inkMuted ??
    darkenUntilLegible(
      mix(ground.anchor, paper, anchorMix),
      ground.anchor,
      backgrounds,
      7,
    );
  const inkFaint =
    overrides.inkFaint ??
    darkenUntilLegible(
      mix(ground.anchor, paper, anchorMix - 0.16),
      ground.anchor,
      backgrounds,
      4.5,
    );

  // Rules are ground, not ink: a hairline that reads as a line, not as a bar.
  const rule = overrides.rule ?? mix(ground.anchor, paper, ground.ruleMix);
  const ruleSoft =
    overrides.ruleSoft ?? mix(ground.anchor, paper, ground.ruleMix * 0.5);

  const contrastReport = [
    ...backgrounds.map((background) => ({
      token: "--ink-muted",
      against: background,
      ratio: round(contrastRatio(inkMuted, background), 2),
    })),
    ...backgrounds.map((background) => ({
      token: "--ink-faint",
      against: background,
      ratio: round(contrastRatio(inkFaint, background), 2),
    })),
  ];

  return Object.freeze({
    paper,
    inkMuted,
    inkFaint,
    rule,
    ruleSoft,
    contrastReport: Object.freeze(contrastReport),
  });
}

function darkenUntilLegible(
  start: string,
  anchor: string,
  backgrounds: readonly string[],
  target: number,
): string {
  let candidate = start;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const worst = Math.min(
      ...backgrounds.map((background) => contrastRatio(candidate, background)),
    );
    if (worst >= target) return candidate;
    candidate = mix(anchor, candidate, 0.08);
  }
  return anchor;
}

/* ------------------------------------------------------------------ media */

const mediaScale: Readonly<
  Record<
    StarterBrief["media"]["scale"],
    {
      wide: string;
      tall: string;
      square: string;
      panorama: string;
      mobileWide: string;
      mobilePanorama: string;
      splitWeight: number;
    }
  >
> = {
  RESTRAINED: {
    wide: "16 / 10",
    tall: "4 / 5",
    square: "1 / 1",
    panorama: "21 / 8",
    mobileWide: "5 / 4",
    mobilePanorama: "4 / 3",
    splitWeight: 0.4,
  },
  BALANCED: {
    wide: "3 / 2",
    tall: "3 / 4",
    square: "1 / 1",
    panorama: "2 / 1",
    mobileWide: "5 / 4",
    mobilePanorama: "3 / 2",
    splitWeight: 0.46,
  },
  DOMINANT: {
    wide: "4 / 3",
    tall: "2 / 3",
    square: "1 / 1",
    panorama: "16 / 9",
    mobileWide: "1 / 1",
    mobilePanorama: "4 / 3",
    splitWeight: 0.54,
  },
};

function resolveMedia(brief: StarterBrief): ResolvedMedia {
  const scale = mediaScale[brief.media.scale];
  return Object.freeze({
    ratios: Object.freeze({
      wide: scale.wide,
      tall: scale.tall,
      square: scale.square,
      panorama: scale.panorama,
    }),
    mobileRatios: Object.freeze({
      wide: scale.mobileWide,
      panorama: scale.mobilePanorama,
    }),
    radius: `${round(brief.media.radius, 3)}rem`,
    caption: brief.media.caption,
    splitWeight: scale.splitWeight,
  });
}

function resolveBreakpoints(brief: StarterBrief): ResolvedBreakpoints {
  const mid = round(brief.navigation.collapseAt, 3);
  return Object.freeze({
    // A split composition unstacks a little above the navigation collapse so the
    // two changes never land on the same width and read as one lurch.
    wide: `${round(Math.max(mid + 12, 60), 3)}rem`,
    mid: `${mid}rem`,
    narrow: "26rem",
  });
}

/* ------------------------------------------------------------ colour math */

export function contrastRatio(left: string, right: string): number {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const normalized = value / 255;
    return normalized <= 0.039_28
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/** Mixes `amount` of `from` into `to`. */
export function mix(from: string, to: string, amount: number): string {
  const left = channels(from);
  const right = channels(to);
  const blended = left.map((value, index) =>
    Math.round(value * amount + (right[index] ?? 0) * (1 - amount)),
  );
  return `#${blended.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
