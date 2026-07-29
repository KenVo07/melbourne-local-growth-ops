import {
  HANDOFF_MANIFEST_DIGEST_PATH,
  HANDOFF_MANIFEST_PATH,
  sha256,
  textContent,
} from "./handoff-integrity.js";
import {
  isSafeHandoffFilePath,
  containsSecretMaterial,
  issue,
  privateDependencyReference,
  scanArtifact,
  sortedIssues,
} from "./handoff-scanner.js";
import type {
  ClientHandoffExportFile,
  ClientHandoffIssue,
  ClientHandoffManifest,
  ClientHandoffManifestValidationResult,
  ClientHandoffVerificationResult,
  HandoffFileInventoryRecord,
  OptionalDataRestorePlan,
  RequiredEnvironmentVariable,
} from "./handoff-types.js";

const exactCommands = [
  "pnpm install --frozen-lockfile --ignore-scripts",
  "pnpm typecheck",
  "pnpm build",
  "pnpm test",
  "pnpm verify:handoff",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, maximum = 500): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum;
}

function exactIso(value: unknown): value is string {
  if (!nonEmpty(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function validEnvironment(
  value: unknown,
): value is RequiredEnvironmentVariable {
  return isRecord(value) &&
    typeof value.name === "string" &&
    /^[A-Z][A-Z0-9_]{1,99}$/.test(value.name) &&
    nonEmpty(value.description, 300) &&
    typeof value.required === "boolean" &&
    value.owner === "CLIENT";
}

function validInventory(
  value: unknown,
): value is HandoffFileInventoryRecord {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    !isSafeHandoffFilePath(value.path) ||
    ![
      "SOURCE",
      "ASSET",
      "CONFIGURATION",
      "VENDORED_RUNTIME",
      "TEST",
      "PACKAGE",
      "GENERATED_HANDOFF",
    ].includes(String(value.category)) ||
    typeof value.size !== "number" ||
    !Number.isInteger(value.size) ||
    value.size < 0 ||
    value.size > 10 * 1024 * 1024 ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !isRecord(value.provenance) ||
    ![
      "GENERATED",
      "CLIENT_ASSET",
      "TRANSFORMED_FACTORY_RUNTIME",
    ].includes(String(value.provenance.origin)) ||
    !nonEmpty(value.provenance.version, 100)
  ) {
    return false;
  }
  return true;
}

function validRestorePlan(value: unknown): value is OptionalDataRestorePlan {
  if (!isRecord(value)) {
    return false;
  }
  if (value.status === "NOT_APPLICABLE") {
    return value.reason ===
      "No optional persistent infrastructure is configured";
  }
  if (value.status !== "REQUIRED" || !Array.isArray(value.resources)) {
    return false;
  }
  return value.resources.length > 0 &&
    value.resources.every((resource) =>
      isRecord(resource) &&
      ["DATABASE", "AUTHENTICATION", "OBJECT_STORAGE"].includes(
        String(resource.kind),
      ) &&
      nonEmpty(resource.provider, 100) &&
      resource.dataOwner === "CLIENT" &&
      resource.backupOwner === "CLIENT" &&
      resource.restoreOwner === "CLIENT" &&
      nonEmpty(resource.backupProcedure) &&
      nonEmpty(resource.restoreProcedure) &&
      nonEmpty(resource.verificationProcedure)
    );
}

function validSelection(
  value: unknown,
  idField: "moduleId" | "connectorId",
): boolean {
  return isRecord(value) &&
    nonEmpty(value[idField], 100) &&
    nonEmpty(value.type, 100) &&
    nonEmpty(value.version, 100) &&
    (value.portability === "TRANSFERABLE" ||
      value.portability === "CLIENT_OWNED");
}

function validVerification(value: unknown): boolean {
  if (
    !isRecord(value) ||
    value.packageManager !== "pnpm@11.9.0" ||
    value.nodeVersion !== "24.18.0" ||
    value.integrityAlgorithm !== "SHA256" ||
    value.manifestDigestPath !== HANDOFF_MANIFEST_DIGEST_PATH ||
    value.verifierPath !== "scripts/verify-handoff.mjs" ||
    !Array.isArray(value.commands) ||
    value.commands.length !== exactCommands.length
  ) {
    return false;
  }
  const commands = value.commands;
  return exactCommands.every((command, index) =>
    commands[index] === command
  );
}

function manifestIssue(): ClientHandoffManifestValidationResult {
  return Object.freeze({
    success: false,
    issues: Object.freeze([
      issue(
        "INVALID_HANDOFF_MANIFEST",
        HANDOFF_MANIFEST_PATH,
        "Handoff manifest is incomplete, unsafe, or not client-owned",
      ),
    ]),
  });
}

export function validateClientHandoffManifest(
  value: unknown,
): ClientHandoffManifestValidationResult {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !nonEmpty(value.clientId, 100) ||
    !nonEmpty(value.deploymentId, 100) ||
    !nonEmpty(value.configurationId, 100) ||
    typeof value.configurationVersion !== "number" ||
    !Number.isInteger(value.configurationVersion) ||
    value.configurationVersion < 1 ||
    !nonEmpty(value.repositoryName, 100) ||
    !/^[a-z0-9][a-z0-9-]{0,99}$/.test(value.repositoryName) ||
    !exactIso(value.exportedAt) ||
    !isRecord(value.ownership) ||
    value.ownership.sourceRepository !== "CLIENT" ||
    value.ownership.hosting !== "CLIENT" ||
    value.ownership.analytics !== "CLIENT" ||
    value.ownership.domains !== "CLIENT" ||
    !Array.isArray(value.domains) ||
    value.domains.length === 0 ||
    !value.domains.every((domain) =>
      isRecord(domain) &&
      nonEmpty(domain.hostname, 253) &&
      typeof domain.canonical === "boolean"
    ) ||
    !Array.isArray(value.requiredEnvironmentVariables) ||
    !value.requiredEnvironmentVariables.every(validEnvironment) ||
    !Array.isArray(value.includedFiles) ||
    value.includedFiles.length === 0 ||
    !value.includedFiles.every(validInventory) ||
    !Array.isArray(value.includedAssets) ||
    !value.includedAssets.every(validInventory) ||
    !Array.isArray(value.modules) ||
    !value.modules.every((selection) =>
      validSelection(selection, "moduleId")
    ) ||
    !Array.isArray(value.connectors) ||
    !value.connectors.every((selection) =>
      validSelection(selection, "connectorId")
    ) ||
    !Array.isArray(value.publicDependencies) ||
    !value.publicDependencies.every((dependency) =>
      isRecord(dependency) &&
      nonEmpty(dependency.name, 214) &&
      nonEmpty(dependency.version, 100) &&
      !privateDependencyReference(
        `${dependency.name}:${dependency.version}`,
      )
    ) ||
    !isRecord(value.buildProvenance) ||
    !nonEmpty(value.buildProvenance.applicationVersion, 100) ||
    !nonEmpty(value.buildProvenance.buildId, 200) ||
    !nonEmpty(value.buildProvenance.sourceRevision, 200) ||
    !exactIso(value.buildProvenance.generatedAt) ||
    !validRestorePlan(value.optionalDataRestorePlan) ||
    !validVerification(value.verification) ||
    !isRecord(value.scans) ||
    value.scans.privateDependencies !== "PASSED" ||
    value.scans.secrets !== "PASSED" ||
    value.scans.clientIsolation !== "PASSED"
  ) {
    return manifestIssue();
  }

  const inventoryPaths = value.includedFiles.map(({ path }) => path);
  const environmentNames = value.requiredEnvironmentVariables.map(
    ({ name }) => name,
  );
  const actualAssets = value.includedFiles
    .filter(({ category }) => category === "ASSET");
  const domainNames = value.domains.map(({ hostname }) => hostname);
  const moduleIds = value.modules.map(({ moduleId }) => moduleId);
  const connectorIds = value.connectors.map(({ connectorId }) => connectorId);
  const dependencyNames = value.publicDependencies.map(({ name }) => name);
  if (
    new Set(inventoryPaths).size !== inventoryPaths.length ||
    new Set(environmentNames).size !== environmentNames.length ||
    new Set(domainNames).size !== domainNames.length ||
    value.domains.filter(({ canonical }) => canonical).length !== 1 ||
    new Set(moduleIds).size !== moduleIds.length ||
    new Set(connectorIds).size !== connectorIds.length ||
    new Set(dependencyNames).size !== dependencyNames.length ||
    JSON.stringify(value.includedAssets) !== JSON.stringify(actualAssets) ||
    containsSecretMaterial(JSON.stringify(value))
  ) {
    return manifestIssue();
  }
  return Object.freeze({
    success: true,
    data: value as unknown as ClientHandoffManifest,
  });
}

function decodeManifest(
  file: ClientHandoffExportFile,
): unknown {
  const text = textContent(file.content);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function verifyClientHandoffExport(
  files: readonly ClientHandoffExportFile[],
): ClientHandoffVerificationResult {
  const issues: ClientHandoffIssue[] = [];
  const byPath = new Map<string, ClientHandoffExportFile>();
  for (const file of files) {
    if (
      !isSafeHandoffFilePath(file.path) ||
      byPath.has(file.path)
    ) {
      issues.push(issue(
        "UNEXPECTED_EXPORTED_FILE",
        file.path,
        "Export contains a duplicate or unsafe file path",
      ));
      continue;
    }
    byPath.set(file.path, file);
    if (
      file.size !== file.content.byteLength ||
      file.sha256 !== sha256(file.content)
    ) {
      issues.push(issue(
        "INTEGRITY_MISMATCH",
        file.path,
        "Export file metadata does not match its content",
      ));
    }
  }

  const manifestFile = byPath.get(HANDOFF_MANIFEST_PATH);
  const digestFile = byPath.get(HANDOFF_MANIFEST_DIGEST_PATH);
  if (manifestFile === undefined || digestFile === undefined) {
    return Object.freeze({
      success: false,
      issues: Object.freeze([
        issue(
          "MISSING_EXPORTED_FILE",
          HANDOFF_MANIFEST_PATH,
          "Manifest and manifest digest are required",
        ),
      ]),
    });
  }
  const expectedManifestDigest = textContent(digestFile.content)?.trim();
  if (
    expectedManifestDigest === undefined ||
    expectedManifestDigest !== sha256(manifestFile.content)
  ) {
    issues.push(issue(
      "INTEGRITY_MISMATCH",
      HANDOFF_MANIFEST_PATH,
      "Manifest digest does not match the transferred manifest",
    ));
  }
  const validated = validateClientHandoffManifest(
    decodeManifest(manifestFile),
  );
  if (!validated.success) {
    issues.push(...validated.issues);
    return Object.freeze({
      success: false,
      issues: sortedIssues(issues),
    });
  }
  const manifest = validated.data;
  const expectedPaths = new Set<string>();
  for (const inventory of manifest.includedFiles) {
    expectedPaths.add(inventory.path);
    const file = byPath.get(inventory.path);
    if (file === undefined) {
      issues.push(issue(
        "MISSING_EXPORTED_FILE",
        inventory.path,
        "Manifest inventory file is missing",
      ));
      continue;
    }
    if (
      file.content.byteLength !== inventory.size ||
      sha256(file.content) !== inventory.sha256
    ) {
      issues.push(issue(
        "INTEGRITY_MISMATCH",
        inventory.path,
        "Exported content does not match the manifest inventory",
      ));
    }
    const scanIssues = scanArtifact(
      {
        path: inventory.path,
        content: file.content,
        category: inventory.category === "GENERATED_HANDOFF"
          ? "CONFIGURATION"
          : inventory.category,
        clientId: manifest.clientId,
        provenance: inventory.provenance,
      },
      manifest.clientId,
      [],
      manifest.requiredEnvironmentVariables,
    );
    issues.push(...scanIssues.filter(({ code }) =>
      code === "SECRET_MATERIAL" ||
      code === "PRIVATE_DEPENDENCY" ||
      code === "UNDOCUMENTED_ENVIRONMENT_VARIABLE"
    ));
  }
  for (const path of byPath.keys()) {
    if (
      path !== HANDOFF_MANIFEST_PATH &&
      path !== HANDOFF_MANIFEST_DIGEST_PATH &&
      !expectedPaths.has(path)
    ) {
      issues.push(issue(
        "UNEXPECTED_EXPORTED_FILE",
        path,
        "Transferred repository contains a file outside the manifest inventory",
      ));
    }
  }

  const readme = byPath.get("README.md");
  const checklist = byPath.get("HANDOFF-CHECKLIST.md");
  const verifier = byPath.get("scripts/verify-handoff.mjs");
  const readmeText = readme === undefined
    ? undefined
    : textContent(readme.content);
  const checklistText = checklist === undefined
    ? undefined
    : textContent(checklist.content);
  if (
    readmeText === undefined ||
    checklistText === undefined ||
    verifier === undefined ||
    !/Environment setup/.test(readmeText) ||
    !/Domain ownership/.test(readmeText) ||
    !/Analytics ownership/.test(readmeText) ||
    !/Contact-form provider setup/.test(readmeText) ||
    !/Rollback/.test(readmeText) ||
    !/Recovery/.test(readmeText) ||
    !/Optional-data plan status/.test(checklistText)
  ) {
    issues.push(issue(
      "RECOVERY_VERIFICATION_FAILED",
      "README.md",
      "Recovery documentation, checklist, or portable verifier is missing",
    ));
  }

  if (issues.length > 0) {
    return Object.freeze({
      success: false,
      issues: sortedIssues(issues),
    });
  }
  return Object.freeze({
    success: true,
    manifest,
    checks: Object.freeze({
      integrity: "PASSED",
      portability: "PASSED",
      recovery: "PASSED",
    }),
  });
}
