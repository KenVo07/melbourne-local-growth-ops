import {
  verifyClientHandoffDirectory,
} from "../../packages/deployment/dist/index.js";

import { runHandoffCommand } from "./command-output.mjs";

/**
 * Recovery preflight only. Provider rollback, account transfer, DNS mutation,
 * and optional-data restore remain separate, explicitly authorized operations.
 */
export async function verifyHandoffRecoveryCommand({
  directory,
  verify = verifyClientHandoffDirectory,
  write,
}) {
  return runHandoffCommand(async () => {
    const result = await verify(directory);
    if (!result.success) return result;
    return Object.freeze({
      success: true,
      clientId: result.manifest.clientId,
      deploymentId: result.manifest.deploymentId,
      repositoryName: result.manifest.repositoryName,
      optionalDataRestorePlan: result.manifest.optionalDataRestorePlan,
      recovery: result.checks.recovery,
      externalProviderMutation: false,
    });
  }, write);
}
