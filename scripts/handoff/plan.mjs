import { createClientHandoffExport } from "../../packages/deployment/dist/index.js";

import { runHandoffCommand } from "./command-output.mjs";

/**
 * Pure planning boundary. It validates and assembles the exact export bytes,
 * but does not touch the filesystem or invoke package commands.
 */
export async function planClientHandoffCommand({
  input,
  createExport = createClientHandoffExport,
  write,
}) {
  return runHandoffCommand(() => {
    const result = createExport(input);
    if (!result.success) return result;
    return Object.freeze({
      success: true,
      plan: Object.freeze({
        repositoryName: result.export.repositoryName,
        clientId: result.export.manifest.clientId,
        deploymentId: result.export.manifest.deploymentId,
        exportedAt: result.export.exportedAt,
        fileCount: result.export.files.length,
        manifestDigest: result.export.manifestDigest,
        privateDependencyScan: result.export.manifest.scans.privateDependencies,
        secretScan: result.export.manifest.scans.secrets,
        clientIsolationScan: result.export.manifest.scans.clientIsolation,
      }),
    });
  }, write);
}
