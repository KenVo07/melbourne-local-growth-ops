/**
 * The Proportion P1 Experience Starter.
 *
 * Private Factory machinery that emits a concrete, client-local Client
 * Experience source tree from a client build package and a creative brief. It
 * is a source-generation accelerator: what it writes is ordinary client source
 * with no runtime relationship to this package.
 */
export {
  generateExperienceStarter,
  StarterGenerationError,
  type GeneratedExperience,
  type GeneratedExperienceFile,
  type GenerateExperienceStarterOptions,
} from "./generate.js";
export {
  validateStarterBrief,
  StarterBriefSchema,
  StarterInteractionSchema,
  type StarterBrief,
  type StarterComposition,
  type StarterCopy,
  type StarterInteraction,
  type StarterMediaPlacement,
  type StarterMotion,
  type StarterServiceNarrative,
} from "./brief.js";
export {
  resolveDesign,
  resolveInteraction,
  contrastRatio,
  type ResolvedDesign,
  type ResolvedInteraction,
} from "./decisions.js";
export {
  decideDisclosure,
  disclosureFor,
  foldsAway,
  decideProjectMediaTreatment,
  planInteractions,
  type DisclosureDecision,
  type DisclosureTreatment,
  type InteractionDecision,
  type InteractionPlan,
  type MediaTreatment,
} from "./interaction-decisions.js";
export {
  readDetailRuns,
  revealsRole,
  feedsBack,
  type AccessPattern,
  type DetailRun,
  type FeedbackRole,
  type RevealRole,
} from "./semantic-opportunities.js";
export { KNOWN_ROUTES } from "./emit/entrypoint.js";
