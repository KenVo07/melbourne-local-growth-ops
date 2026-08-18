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
  decideContactFaqTreatment,
  decideProjectMediaTreatment,
  decideServiceQuestionTreatment,
  type DisclosureTreatment,
  type InteractionDecision,
  type MediaTreatment,
} from "./interaction-decisions.js";
export { KNOWN_ROUTES } from "./emit/entrypoint.js";
