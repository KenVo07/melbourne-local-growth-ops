import { runCommand } from "./command-output.mjs";

export async function rollbackDeploymentCommand({
  lifecycle,
  intent,
  target,
  options,
  write,
}) {
  return runCommand(
    () => lifecycle.rollback(intent, target, options),
    write,
  );
}
