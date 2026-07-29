import {
  createClientHandoffExport,
  writeClientHandoffDirectory,
} from "../../packages/deployment/dist/index.js";

import { runHandoffCommand } from "./command-output.mjs";

/**
 * Explicit filesystem apply boundary. The destination must be empty and no
 * existing file is replaced.
 */
export async function exportClientRepositoryCommand({
  input,
  destination,
  createExport = createClientHandoffExport,
  writeDirectory = writeClientHandoffDirectory,
  write,
}) {
  return runHandoffCommand(async () => {
    const result = createExport(input);
    if (!result.success) return result;
    const materialized = await writeDirectory(result.export, destination);
    if (!materialized.success) return materialized;
    return Object.freeze({
      success: true,
      directory: materialized.directory,
      fileCount: materialized.fileCount,
      manifestDigest: materialized.manifestDigest,
    });
  }, write);
}
