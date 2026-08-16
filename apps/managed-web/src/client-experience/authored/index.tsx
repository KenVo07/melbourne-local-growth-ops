import type { ClientExperienceDefinition } from "../contract";

/**
 * Authored client experience source slot.
 *
 * A legacy (`schemaVersion: 1`) client has no authored experience, so this
 * placeholder exports `undefined` and nothing in the client-experience runtime
 * is reached. The generator replaces this directory with the client's inspected
 * `experience/` source when assembling an authored artifact, which is why the
 * import path is fixed rather than configurable.
 *
 * This file is the only module the Kernel imports from authored source. Do not
 * add Platform logic here.
 */
export const authoredClientExperience: ClientExperienceDefinition | undefined =
  undefined;
