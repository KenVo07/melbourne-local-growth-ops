import { createHash } from "node:crypto";

import { validateStarterBrief, type StarterBrief } from "./brief.js";
import { resolveDesign, type ResolvedDesign } from "./decisions.js";
import { emitSiteContent } from "./emit/content.js";
import { emitDesignDna } from "./emit/design-dna.js";
import { emitEntrypoint, emitManifest, KNOWN_ROUTES } from "./emit/entrypoint.js";
import {
  emitDisclosure,
  emitMediaViewer,
  emitMotionPreference,
  emitReveal,
} from "./emit/interaction-runtime.js";
import { emitPieces } from "./emit/pieces.js";
import { emitAboutContactRoutes } from "./emit/routes/about-contact.js";
import { emitHomeRoute } from "./emit/routes/home.js";
import { emitProjectsRoutes } from "./emit/routes/projects.js";
import { emitServicesRoutes } from "./emit/routes/services.js";
import { emitShell } from "./emit/shell.js";
import { emitStylesheet } from "./emit/stylesheet.js";
import {
  planInteractions,
  type InteractionPlan,
} from "./interaction-decisions.js";

/**
 * The P1 Experience Starter.
 *
 * Given a validated client definition and a creative brief, emits a complete
 * client-local `experience/` source tree — the same fixed shape a hand-authored
 * Client Experience uses, at the same source boundary, consumed by the same
 * artifact assembler.
 *
 * The single most important property: **the emitted source has no runtime
 * relationship with this package**. Nothing it writes imports
 * `@melbourne-local-growth-ops/experience-starter`, and this package is not in
 * the artifact's runtime file list or its vendored packages, so a generated
 * client can be exported, installed, built, edited and rewritten with the
 * Factory absent. The starter is a source accelerator, not a shared template.
 */

export class StarterGenerationError extends Error {
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = "StarterGenerationError";
    this.detail = Object.freeze({ ...detail });
  }
}

export interface GeneratedExperienceFile {
  readonly path: string;
  readonly contents: string;
  readonly sha256: string;
  readonly lines: number;
}

export interface GeneratedExperience {
  readonly files: readonly GeneratedExperienceFile[];
  readonly design: ResolvedDesign;
  /** Which interactions this client's content and language selected, and why. */
  readonly interactions: InteractionPlan;
  readonly routeIds: readonly string[];
  /** A digest over every emitted path and its bytes. */
  readonly sourceHash: string;
  readonly totalLines: number;
}

export interface GenerateExperienceStarterOptions {
  /** The client definition, exactly as `assemble:client` will read it. */
  readonly definition: unknown;
  /** The creative and editorial brief. */
  readonly brief: unknown;
}

interface DefinitionFacts {
  readonly profile: string;
  readonly surfaceColour: string;
  readonly routeIds: readonly string[];
  readonly serviceIds: readonly string[];
  readonly assetIds: ReadonlySet<string>;
  /** Questions the client's own FAQ section carries. */
  readonly faqCount: number;
}

export function generateExperienceStarter(
  options: GenerateExperienceStarterOptions,
): GeneratedExperience {
  const briefValidation = validateStarterBrief(options.brief);
  if (!briefValidation.success) {
    throw new StarterGenerationError(
      `Starter brief is invalid: ${briefValidation.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
      { issues: briefValidation.issues },
    );
  }
  const brief = briefValidation.data;
  const facts = readDefinition(options.definition);
  assertBriefMatchesClient(brief, facts);

  const design = resolveDesign({
    brief,
    brandSurfaceColour: facts.surfaceColour,
    profile: facts.profile,
  });
  assertGroundIsLegible(design, facts.surfaceColour);

  /*
   * Which interactions this client gets, decided once from its content and its
   * language and then obeyed by every emitter. Emission is conditional on it,
   * so a client that selects nothing receives no helper source, no helper CSS
   * and no client JavaScript.
   */
  const plan = planInteractions({
    interaction: design.interaction,
    routeIds: facts.routeIds,
    faqCount: facts.faqCount,
    serviceQuestionCount: Math.min(
      ...brief.serviceNarratives.map(({ questions }) => questions.length),
    ),
  });

  const files: GeneratedExperienceFile[] = [
    file("manifest.json", emitManifest(design, facts.routeIds, plan)),
    file("design-dna.json", emitDesignDna(design)),
    file("index.tsx", emitEntrypoint(design, facts.routeIds)),
    file("content/site-content.ts", emitSiteContent(brief)),
    file("components/Shell.tsx", emitShell(design)),
    file("components/Pieces.tsx", emitPieces(design)),
    file("styles/site.css", emitStylesheet(design, plan)),
  ];

  if (facts.routeIds.includes("home")) {
    files.push(file("routes/HomeRoute.tsx", emitHomeRoute(design)));
  }
  if (
    facts.routeIds.includes("services-index") ||
    facts.routeIds.includes("service-detail")
  ) {
    files.push(file("routes/ServicesRoutes.tsx", emitServicesRoutes(design)));
  }
  if (
    facts.routeIds.includes("projects-index") ||
    facts.routeIds.includes("project-detail")
  ) {
    files.push(file("routes/ProjectsRoutes.tsx", emitProjectsRoutes(design)));
  }
  // Always emitted: it carries the not-found route, which every experience uses.
  files.push(
    file("routes/AboutContactRoutes.tsx", emitAboutContactRoutes(design)),
  );
  /*
   * Interaction helpers. Each is client-local source over native browser APIs,
   * emitted only when this client's plan actually uses it.
   */
  if (plan.usesReveal || plan.usesDisclosure) {
    files.push(file("components/motion.ts", emitMotionPreference()));
  }
  if (plan.usesReveal) {
    files.push(file("components/Reveal.tsx", emitReveal()));
  }
  if (plan.usesDisclosure) {
    files.push(file("components/Disclosure.tsx", emitDisclosure(design)));
  }
  if (plan.usesMediaExplorer) {
    files.push(file("components/MediaViewer.tsx", emitMediaViewer(design)));
  }

  files.sort((left, right) => (left.path < right.path ? -1 : 1));

  return Object.freeze({
    files: Object.freeze(files),
    design,
    interactions: plan,
    routeIds: facts.routeIds,
    sourceHash: digest(
      JSON.stringify(files.map(({ path, sha256 }) => ({ path, sha256 }))),
    ),
    totalLines: files.reduce((total, entry) => total + entry.lines, 0),
  });
}

/**
 * Reads exactly the facts generation needs out of the client definition.
 *
 * The definition is the same object the assembler validates; this does not
 * re-implement that validation, it fails loudly on the handful of shapes the
 * emitters depend on so a malformed package produces a clear error here rather
 * than a broken TSX file three steps later.
 */
function readDefinition(definition: unknown): DefinitionFacts {
  const root = definition as {
    schemaVersion?: unknown;
    profile?: {
      profile?: unknown;
      brand?: { surfaceColor?: unknown };
      sections?: readonly { type?: unknown; items?: readonly unknown[] }[];
    };
    pageGraph?: { pages?: readonly { experienceRouteId?: unknown }[] };
    assets?: readonly { assetId?: unknown }[];
  };
  if (root?.schemaVersion !== 2) {
    throw new StarterGenerationError(
      "The P1 Experience Starter generates source for schemaVersion 2 client definitions only.",
    );
  }
  const profile = root.profile?.profile;
  const surfaceColour = root.profile?.brand?.surfaceColor;
  if (typeof profile !== "string" || typeof surfaceColour !== "string") {
    throw new StarterGenerationError(
      "Client definition is missing profile.profile or profile.brand.surfaceColor.",
    );
  }
  const pages = root.pageGraph?.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new StarterGenerationError(
      "Client definition carries no page graph, so there is nothing to compose.",
    );
  }
  const routeIds = [
    ...new Set(
      pages
        .map(({ experienceRouteId }) => experienceRouteId)
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  const unknown = routeIds.filter((routeId) => KNOWN_ROUTES[routeId] === undefined);
  if (unknown.length > 0) {
    throw new StarterGenerationError(
      `The starter has no composition for route ${unknown.map((id) => `"${id}"`).join(", ")}. Author that route by hand, or extend the starter deliberately — it will not invent a layout for a page kind nobody has designed.`,
      { unknownRouteIds: unknown },
    );
  }
  const serviceIds = (root.profile?.sections ?? [])
    .filter((section) => section.type === "SERVICES")
    .flatMap((section) => section.items ?? [])
    .map((item) => (item as { serviceId?: unknown }).serviceId)
    .filter((value): value is string => typeof value === "string");
  const faqSection = (root.profile?.sections ?? []).find(
    (section) => section.type === "FAQ",
  );
  const assetIds = new Set(
    (root.assets ?? [])
      .map(({ assetId }) => assetId)
      .filter((value): value is string => typeof value === "string"),
  );
  return Object.freeze({
    profile,
    surfaceColour,
    routeIds: Object.freeze(routeIds),
    serviceIds: Object.freeze(serviceIds),
    assetIds,
    faqCount: faqSection?.items?.length ?? 0,
  });
}

/**
 * Refuses a brief that does not describe this client.
 *
 * A media plan naming an asset the client never licensed, or a narrative for a
 * service that does not exist, would compile and then fail at render. Both are
 * cheap to catch here and expensive to find in a screenshot.
 */
function assertBriefMatchesClient(
  brief: StarterBrief,
  facts: DefinitionFacts,
): void {
  const referenced = [
    brief.mediaPlan.homeHero.assetId,
    brief.mediaPlan.about.assetId,
    ...(brief.mediaPlan.homeSecondary === undefined
      ? []
      : [brief.mediaPlan.homeSecondary.assetId]),
    ...brief.serviceNarratives.map(({ media }) => media.assetId),
  ];
  const missingAssets = [
    ...new Set(referenced.filter((assetId) => !facts.assetIds.has(assetId))),
  ].sort();
  if (missingAssets.length > 0) {
    throw new StarterGenerationError(
      `The brief places media the client definition does not declare: ${missingAssets.join(", ")}.`,
      { missingAssets },
    );
  }

  const declared = new Set(facts.serviceIds);
  const missingServices = brief.serviceNarratives
    .map(({ serviceId }) => serviceId)
    .filter((serviceId) => !declared.has(serviceId))
    .sort();
  if (missingServices.length > 0) {
    throw new StarterGenerationError(
      `The brief writes narrative for services the profile does not declare: ${missingServices.join(", ")}.`,
      { missingServices },
    );
  }

  if (facts.routeIds.includes("service-detail")) {
    const covered = new Set(
      brief.serviceNarratives.map(({ serviceId }) => serviceId),
    );
    const uncovered = facts.serviceIds.filter(
      (serviceId) => !covered.has(serviceId),
    );
    if (uncovered.length > 0) {
      throw new StarterGenerationError(
        `Every service with a detail route needs narrative and a photograph. Missing: ${uncovered.join(", ")}.`,
        { uncovered },
      );
    }
  }
}

/**
 * Refuses a ground the client's validated brand cannot live on.
 *
 * A dark ground needs light ink; a light brand surface needs dark ink. When a
 * brief pairs the two, no single neutral scale clears AA on both, and the honest
 * outcome is a clear refusal naming the conflict — not a site whose panels are
 * unreadable and whose contrast report quietly says 1.2:1.
 */
function assertGroundIsLegible(
  design: ResolvedDesign,
  brandSurfaceColour: string,
): void {
  const failing = design.colour.contrastReport.filter(
    ({ ratio }) => ratio < 4.5,
  );
  if (failing.length === 0) return;
  throw new StarterGenerationError(
    `The "${design.brief.colour.ground}" ground and the client's configured brand surface ${brandSurfaceColour} cannot share one legible neutral scale (worst ratio ${Math.min(
      ...failing.map(({ ratio }) => ratio),
    )}:1, against ${failing[0]?.against}). A dark ground needs light ink and a light surface needs dark ink; choose a ground of the same polarity as the configured surface, or change the surface in the client definition.`,
    { ground: design.brief.colour.ground, brandSurfaceColour, failing },
  );
}

function file(path: string, contents: string): GeneratedExperienceFile {
  return Object.freeze({
    path,
    contents,
    sha256: digest(contents),
    lines: contents.split("\n").length - (contents.endsWith("\n") ? 1 : 0),
  });
}

function digest(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
