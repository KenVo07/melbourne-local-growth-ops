import { runCommand } from "./command-output.mjs";

export async function inspectDeploymentCommand({
  lifecycle,
  intent,
  observation,
  write,
}) {
  return runCommand(
    () => lifecycle.inspect(intent, observation),
    write,
  );
}
