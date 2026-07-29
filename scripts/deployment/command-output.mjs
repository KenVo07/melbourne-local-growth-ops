export function commandFailure() {
  return Object.freeze({
    success: false,
    error: Object.freeze({
      code: "COMMAND_FAILED",
      message: "Deployment command failed",
    }),
  });
}

export function emitCommandResult(result, write) {
  if (typeof write !== "function") {
    throw new TypeError("Deployment command writer is required");
  }
  write(`${JSON.stringify(result)}\n`);
  return result;
}

export async function runCommand(operation, write) {
  try {
    return emitCommandResult(await operation(), write);
  } catch {
    return emitCommandResult(commandFailure(), write);
  }
}
