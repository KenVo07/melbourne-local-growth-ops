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
  type StarterBrief,
  type StarterComposition,
  type StarterCopy,
  type StarterMediaPlacement,
  type StarterMotion,
  type StarterServiceNarrative,
} from "./brief.js";
export {
  resolveDesign,
  contrastRatio,
  type ResolvedDesign,
} from "./decisions.js";
export { KNOWN_ROUTES } from "./emit/entrypoint.js";
