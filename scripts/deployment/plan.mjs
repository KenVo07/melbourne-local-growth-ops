import { runCommand } from "./command-output.mjs";

/**
 * Pure command boundary. The injected lifecycle is responsible for validating
 * intent; planning never invokes its HTTP transport.
 */
export async function planDeploymentCommand({ lifecycle, intent, write }) {
  return runCommand(() => lifecycle.plan(intent), write);
}
