export {
  createManagedWebsiteDefinition,
  generateClientWebsiteSnapshot,
  parseDefinitionInput,
} from "./generate-client-website";
export { assembleClientSourceArtifact } from "./assemble-client-artifact";
export { verifyClientSourceArtifact } from "./verify-client-artifact";
export type { ClientSourceVerificationResult } from "./verify-client-artifact";
export type {
  AssembleClientSourceArtifactOptions,
  AssembledClientSourceArtifact,
  ClientArtifactDescriptor,
  ClientRuntimeSecretBinding,
  ClientWebsiteDefinitionInput,
  ClientWebsiteSnapshot,
} from "./types";

/*
 * Re-exports for repository tooling that has to orchestrate the Factory's own
 * validators rather than reimplement them -- currently the premium creative
 * bridge in `scripts/creative/`. These are the exact symbols the assembler
 * already uses, made reachable from one place instead of four deep paths.
 *
 * No behaviour is added and no artifact changes: nothing under `src/generation`
 * is copied into a client artifact, so this file has no runtime existence
 * outside the Factory.
 */
export {
  ClientExperienceSourcePolicyError,
  inspectClientExperienceSource,
} from "./client-experience-source-policy";
export type {
  ClientExperienceSourceFile,
  ClientExperienceSourcePolicyErrorCode,
  InspectedClientExperienceSource,
} from "./client-experience-source-policy";
export { approvedClientExperienceDependencies } from "./approved-client-dependencies";
export {
  validateClientExperienceManifest,
  validateWebsiteProfileContent,
  validateWebsiteV2Model,
} from "@melbourne-local-growth-ops/site-core";
