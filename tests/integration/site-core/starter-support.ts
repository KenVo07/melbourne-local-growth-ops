/**
 * Re-exports the P1 Experience Starter's source for the integration tests.
 *
 * Imported by relative path on purpose: the starter is private Factory
 * machinery, and `apps/managed-web` must not depend on it — that absence is
 * itself one of the things `experience-starter-artifact.test.ts` asserts.
 */
export { generateExperienceStarter } from "../../../packages/experience-starter/src/generate";
export {
  loudBrief,
  quietBrief,
  testDefinition,
} from "../../../packages/experience-starter/src/fixtures";
