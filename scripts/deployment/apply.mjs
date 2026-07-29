import { runCommand } from "./command-output.mjs";

/**
 * Explicit mutation boundary. Authentication stays inside the caller-provided
 * transport and never enters command arguments or output.
 */
export async function applyDeploymentCommand({
  lifecycle,
  intent,
  options,
  write,
}) {
  return runCommand(() => lifecycle.apply(intent, options), write);
}
