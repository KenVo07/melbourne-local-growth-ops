export function emitHandoffResult(result, write) {
  if (typeof write !== "function") {
    throw new TypeError("Handoff command writer is required");
  }
  write(`${JSON.stringify(result)}\n`);
  return result;
}

export function handoffCommandFailure(code, message) {
  return Object.freeze({
    success: false,
    error: Object.freeze({ code, message }),
  });
}

export async function runHandoffCommand(operation, write) {
  try {
    return emitHandoffResult(await operation(), write);
  } catch {
    return emitHandoffResult(
      handoffCommandFailure(
        "HANDOFF_COMMAND_FAILED",
        "Client handoff command failed",
      ),
      write,
    );
  }
}
