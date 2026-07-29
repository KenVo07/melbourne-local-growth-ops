import { validateWebsiteRuntimeConfig } from "@melbourne-local-growth-ops/contracts";
import type {
  WebsiteRuntimeConfig,
} from "@melbourne-local-growth-ops/contracts";

import {
  environmentExample,
  handoffChecklist,
  handoffReadme,
  portableVerifierSource,
} from "./handoff-documents.js";
import {
  compareText,
  HANDOFF_MANIFEST_DIGEST_PATH,
  HANDOFF_MANIFEST_PATH,
  jsonFile,
  sha256,
  toBytes,
} from "./handoff-integrity.js";
import { createOptionalDataRestorePlan } from "./handoff-recovery.js";
import {
  isFactoryPrivatePath,
  isSafeExportPath,
  containsSecretMaterial,
  issue,
  privateDependencyReference,
  scanArtifact,
  sortedIssues,
} from "./handoff-scanner.js";
import type {
  ClientHandoffExport,
  ClientHandoffExportFile,
  ClientHandoffExportInput,
  ClientHandoffExportResult,
  ClientHandoffIssue,
  ClientHandoffManifest,
  HandoffArtifactCategory,
  HandoffArtifactInput,
  HandoffConnectorSelection,
  HandoffFileInventoryRecord,
  HandoffModuleSelection,
  RequiredEnvironmentVariable,
} from "./handoff-types.js";

const generatedVersion = "handoff-toolkit@1";
const requiredScripts = new Map([
  ["dev", undefined],
  ["build", undefined],
  ["typecheck", undefined],
  ["test", undefined],
  ["verify:handoff", "node scripts/verify-handoff.mjs"],
]);
interface ParsedPackage {
  readonly dependencies: readonly {
    readonly name: string;
    readonly version: string;
  }[];
}

interface PreparedFile {
  readonly path: string;
  readonly content: Uint8Array;
  readonly category: HandoffArtifactCategory | "GENERATED_HANDOFF";
  readonly provenance: HandoffArtifactInput["provenance"];
}

function exactIso(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

function meaningful(value: unknown, maximum = 200): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validInputEnvelope(value: unknown): value is ClientHandoffExportInput {
  if (
    !isRecord(value) ||
    typeof value.repositoryName !== "string" ||
    typeof value.exportedAt !== "string" ||
    !isRecord(value.ownership) ||
    !isRecord(value.deploymentManifest) ||
    !isRecord(value.deploymentManifest.buildProvenance) ||
    !Array.isArray(value.deploymentManifest.domains) ||
    !Array.isArray(value.artifacts) ||
    !Array.isArray(value.artifactAllowlist) ||
    !Array.isArray(value.moduleSelections) ||
    !Array.isArray(value.connectorSelections) ||
    !Array.isArray(value.publicDependencyAllowlist) ||
    !Array.isArray(value.requiredEnvironmentVariables) ||
    !Array.isArray(value.otherClientIdentifiers) ||
    !Array.isArray(value.optionalDataResources)
  ) {
    return false;
  }
  return (
    value.artifactAllowlist.every((path) => typeof path === "string") &&
    value.publicDependencyAllowlist.every((name) => typeof name === "string") &&
    value.otherClientIdentifiers.every((identifier) =>
      typeof identifier === "string"
    ) &&
    value.moduleSelections.every(isRecord) &&
    value.connectorSelections.every(isRecord) &&
    value.requiredEnvironmentVariables.every(isRecord) &&
    value.optionalDataResources.every(isRecord) &&
    value.artifacts.every((artifact) =>
      isRecord(artifact) &&
      typeof artifact.path === "string" &&
      (typeof artifact.content === "string" ||
        artifact.content instanceof Uint8Array) &&
      typeof artifact.category === "string" &&
      typeof artifact.clientId === "string" &&
      isRecord(artifact.provenance)
    )
  );
}

function repositoryName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(value);
}

function environmentDefinitions(
  variables: readonly RequiredEnvironmentVariable[],
): readonly ClientHandoffIssue[] {
  const issues: ClientHandoffIssue[] = [];
  const names = new Set<string>();
  for (const variable of variables) {
    const path = `requiredEnvironmentVariables.${variable.name}`;
    if (
      !/^[A-Z][A-Z0-9_]{1,99}$/.test(variable.name) ||
      !meaningful(variable.description, 300) ||
      variable.owner !== "CLIENT" ||
      typeof variable.required !== "boolean"
    ) {
      issues.push(issue(
        "INVALID_HANDOFF_INPUT",
        path,
        "Environment variables require a safe name, description, client ownership, and required flag",
      ));
    }
    if (names.has(variable.name)) {
      issues.push(issue(
        "INVALID_HANDOFF_INPUT",
        path,
        "Environment variable documentation is duplicated",
      ));
    }
    names.add(variable.name);
  }
  return issues;
}

function validateArtifactBoundary(
  input: ClientHandoffExportInput,
  clientId: string,
): readonly ClientHandoffIssue[] {
  const issues: ClientHandoffIssue[] = [];
  if (
    input.artifacts.length === 0 ||
    input.artifacts.length > 500 ||
    input.artifactAllowlist.length === 0 ||
    input.artifactAllowlist.length > 500
  ) {
    return [issue(
      "INVALID_HANDOFF_INPUT",
      "artifacts",
      "Handoff requires between 1 and 500 allowlisted artifacts",
    )];
  }

  const artifactPaths = new Set<string>();
  const inputPaths = new Set<string>();
  for (const artifact of input.artifacts) {
    inputPaths.add(artifact.path);
    if (isFactoryPrivatePath(artifact.path)) {
      issues.push(issue(
        "FACTORY_PRIVATE_FILE",
        artifact.path,
        "Factory-only or internal tooling paths cannot be exported",
      ));
      continue;
    }
    if (!isSafeExportPath(artifact.path)) {
      issues.push(issue(
        "UNSAFE_EXPORT_PATH",
        artifact.path,
        "Artifact path is outside the portable handoff allowlist",
      ));
      continue;
    }
    if (artifactPaths.has(artifact.path)) {
      issues.push(issue(
        "DUPLICATE_ARTIFACT",
        artifact.path,
        "Artifact path is included more than once",
      ));
      continue;
    }
    artifactPaths.add(artifact.path);
    if (!input.artifactAllowlist.includes(artifact.path)) {
      issues.push(issue(
        "UNALLOWLISTED_ARTIFACT",
        artifact.path,
        "Artifact is not present in the exact handoff allowlist",
      ));
    }
    if (
      !meaningful(artifact.provenance.version, 100) ||
      ![
        "GENERATED",
        "CLIENT_ASSET",
        "TRANSFORMED_FACTORY_RUNTIME",
      ].includes(artifact.provenance.origin)
    ) {
      issues.push(issue(
        "INVALID_HANDOFF_INPUT",
        artifact.path,
        "Artifact provenance is incomplete",
      ));
    }
    issues.push(
      ...scanArtifact(
        artifact,
        clientId,
        input.otherClientIdentifiers,
        input.requiredEnvironmentVariables,
      ),
    );
  }

  const allowlistPaths = new Set<string>();
  for (const path of input.artifactAllowlist) {
    if (inputPaths.has(path) && !isSafeExportPath(path)) {
      continue;
    }
    if (!isSafeExportPath(path)) {
      if (!artifactPaths.has(path)) {
        issues.push(issue(
          "UNSAFE_EXPORT_PATH",
          path,
          "Allowlisted artifact path is unsafe",
        ));
      }
      continue;
    }
    if (allowlistPaths.has(path)) {
      issues.push(issue(
        "DUPLICATE_ARTIFACT",
        path,
        "Artifact allowlist contains a duplicate path",
      ));
    }
    allowlistPaths.add(path);
    if (!artifactPaths.has(path)) {
      issues.push(issue(
        "MISSING_REQUIRED_ARTIFACT",
        path,
        "An explicitly allowlisted handoff artifact is missing",
      ));
    }
  }
  return issues;
}

function parsePackageJson(
  artifact: HandoffArtifactInput | undefined,
  repository: string,
  publicAllowlist: readonly string[],
): { readonly parsed?: ParsedPackage; readonly issues: readonly ClientHandoffIssue[] } {
  if (artifact === undefined || typeof artifact.content !== "string") {
    return {
      issues: [issue(
        "INVALID_PACKAGE_LAYOUT",
        "package.json",
        "A textual package.json is required",
      )],
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(artifact.content);
  } catch {
    return {
      issues: [issue(
        "INVALID_PACKAGE_LAYOUT",
        "package.json",
        "package.json must be valid JSON",
      )],
    };
  }
  const issues: ClientHandoffIssue[] = [];
  if (!isRecord(value)) {
    return {
      issues: [issue(
        "INVALID_PACKAGE_LAYOUT",
        "package.json",
        "package.json must contain an object",
      )],
    };
  }
  const engines = value.engines;
  const scripts = value.scripts;
  if (
    value.name !== repository ||
    value.private !== true ||
    value.packageManager !== "pnpm@11.9.0" ||
    !isRecord(engines) ||
    engines.node !== "24.18.0" ||
    engines.pnpm !== "11.9.0" ||
    !isRecord(scripts)
  ) {
    issues.push(issue(
      "INVALID_PACKAGE_LAYOUT",
      "package.json",
      "Package identity, pinned Node/pnpm versions, private flag, and scripts must be portable and explicit",
    ));
  } else {
    for (const [name, exact] of requiredScripts) {
      const command = scripts[name];
      if (
        !meaningful(command, 300) ||
        (exact !== undefined && command !== exact)
      ) {
        issues.push(issue(
          "INVALID_PACKAGE_LAYOUT",
          `package.json.scripts.${name}`,
          `Required package script ${name} is missing or unsupported`,
        ));
      }
    }
  }

  const dependencies: { readonly name: string; readonly version: string }[] =
    [];
  for (
    const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ] as const
  ) {
    const dependencyRecord = value[field] ?? {};
    if (!isRecord(dependencyRecord)) {
      issues.push(issue(
        "INVALID_PACKAGE_LAYOUT",
        `package.json.${field}`,
        `${field} must be a dependency object`,
      ));
      continue;
    }
    for (const [name, version] of Object.entries(dependencyRecord)) {
      if (
        !meaningful(version, 100) ||
        privateDependencyReference(`${name}:${version}`) ||
        !publicAllowlist.includes(name)
      ) {
        issues.push(issue(
          "PRIVATE_DEPENDENCY",
          `package.json.${field}.${name}`,
          "Dependency is private, local, workspace-only, or absent from the reviewed public allowlist",
        ));
        continue;
      }
      dependencies.push(Object.freeze({ name, version }));
    }
  }
  return {
    ...(issues.length === 0
      ? {
        parsed: Object.freeze({
          dependencies: Object.freeze(
            dependencies.sort((left, right) =>
              compareText(left.name, right.name)
            ),
          ),
        }),
      }
      : {}),
    issues,
  };
}

function validateLockfile(
  artifact: HandoffArtifactInput | undefined,
): readonly ClientHandoffIssue[] {
  if (artifact === undefined || typeof artifact.content !== "string") {
    return [issue(
      "INVALID_PACKAGE_LAYOUT",
      "pnpm-lock.yaml",
      "A textual pnpm-lock.yaml is required",
    )];
  }
  if (
    privateDependencyReference(artifact.content) ||
    /https?:\/\/(?!registry\.npmjs\.org\/)/i.test(artifact.content)
  ) {
    return [issue(
      "PRIVATE_DEPENDENCY",
      "pnpm-lock.yaml",
      "Lockfile contains a private, local, workspace, Git, or unapproved registry reference",
    )];
  }
  if (!/^lockfileVersion:\s*['"]?9\.0['"]?/m.test(artifact.content)) {
    return [issue(
      "INVALID_PACKAGE_LAYOUT",
      "pnpm-lock.yaml",
      "Lockfile must use the portable pnpm 11 lockfile format",
    )];
  }
  return [];
}

function validateGitIgnore(
  artifact: HandoffArtifactInput | undefined,
): readonly ClientHandoffIssue[] {
  if (artifact === undefined || typeof artifact.content !== "string") {
    return [issue(
      "INVALID_PACKAGE_LAYOUT",
      ".gitignore",
      "A textual .gitignore is required",
    )];
  }
  const entries = new Set(
    artifact.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
  if (
    !entries.has("node_modules/") ||
    !entries.has(".next/") ||
    !entries.has("build/") ||
    !entries.has(".env") ||
    !entries.has(".env.*") ||
    !entries.has("!.env.example")
  ) {
    return [issue(
      "INVALID_PACKAGE_LAYOUT",
      ".gitignore",
      "Handoff repositories must ignore dependencies, build output, Next.js output, and environment values",
    )];
  }
  return [];
}

function validateManifestInput(
  input: ClientHandoffExportInput,
  configuration: WebsiteRuntimeConfig,
): readonly ClientHandoffIssue[] {
  const manifest = input.deploymentManifest;
  const issues: ClientHandoffIssue[] = [];
  if (
    manifest.schemaVersion !== 1 ||
    manifest.clientId !== configuration.clientId ||
    manifest.deploymentId !== configuration.deploymentId ||
    manifest.configurationId !== configuration.configurationId ||
    manifest.configurationVersion !== configuration.configurationVersion ||
    manifest.deliveryMode !== "CLIENT_HANDOFF" ||
    manifest.handoff?.targetOwner !== "CLIENT" ||
    !exactIso(manifest.buildProvenance.generatedAt) ||
    !meaningful(manifest.buildProvenance.buildId) ||
    !meaningful(manifest.buildProvenance.sourceRevision) ||
    !meaningful(manifest.applicationVersion)
  ) {
    issues.push(issue(
      "INVALID_HANDOFF_INPUT",
      "deploymentManifest",
      "Deployment manifest must be an observed client-handoff build for the exact validated configuration",
    ));
  }
  const configuredDomains = [...configuration.domains]
    .map((domain) => domain.hostname)
    .sort(compareText);
  const observedDomains = [...manifest.domains]
    .map((domain) => domain.hostname)
    .sort(compareText);
  if (JSON.stringify(configuredDomains) !== JSON.stringify(observedDomains)) {
    issues.push(issue(
      "INVALID_HANDOFF_INPUT",
      "deploymentManifest.domains",
      "Observed deployment domains must match the validated client configuration",
    ));
  }
  if (
    input.ownership.sourceRepository !== "CLIENT" ||
    input.ownership.hosting !== "CLIENT" ||
    input.ownership.analytics !== "CLIENT" ||
    input.ownership.domains !== "CLIENT"
  ) {
    issues.push(issue(
      "INVALID_HANDOFF_INPUT",
      "ownership",
      "Repository, hosting, analytics, and domain ownership must transfer to the client",
    ));
  }
  if (!repositoryName(input.repositoryName)) {
    issues.push(issue(
      "INVALID_HANDOFF_INPUT",
      "repositoryName",
      "Repository name must use lowercase letters, numbers, and hyphens",
    ));
  }
  if (!exactIso(input.exportedAt)) {
    issues.push(issue(
      "INVALID_HANDOFF_INPUT",
      "exportedAt",
      "Export timestamp must be supplied as an exact ISO timestamp",
    ));
  }
  const manifestMetadata = JSON.stringify({
    repositoryName: input.repositoryName,
    exportedAt: input.exportedAt,
    moduleSelections: input.moduleSelections,
    connectorSelections: input.connectorSelections,
    requiredEnvironmentVariables: input.requiredEnvironmentVariables,
    optionalDataResources: input.optionalDataResources,
    buildProvenance: input.deploymentManifest.buildProvenance,
    applicationVersion: input.deploymentManifest.applicationVersion,
    domains: configuration.domains,
    clientId: configuration.clientId,
    deploymentId: configuration.deploymentId,
    configurationId: configuration.configurationId,
  });
  if (containsSecretMaterial(manifestMetadata)) {
    issues.push(issue(
      "SECRET_MATERIAL",
      "handoffMetadata",
      "Handoff metadata contains credential-shaped material",
    ));
  }
  if (privateDependencyReference(manifestMetadata)) {
    issues.push(issue(
      "PRIVATE_DEPENDENCY",
      "handoffMetadata",
      "Handoff metadata contains a private, local, or workspace-only reference",
    ));
  }
  if (
    input.otherClientIdentifiers.some((identifier) =>
      !meaningful(identifier, 100) ||
      identifier === configuration.clientId
    )
  ) {
    issues.push(issue(
      "INVALID_HANDOFF_INPUT",
      "otherClientIdentifiers",
      "Other-client identifiers must be explicit and distinct from the export client",
    ));
  }
  if (
    input.otherClientIdentifiers.some((identifier) =>
      identifier.length > 0 && manifestMetadata.includes(identifier)
    )
  ) {
    issues.push(issue(
      "CLIENT_ISOLATION_VIOLATION",
      "handoffMetadata",
      "Handoff metadata contains another client's identifier",
    ));
  }
  if (
    configuration.configuredInfrastructure.some(({ accountOwner }) =>
      accountOwner !== "CLIENT"
    )
  ) {
    issues.push(issue(
      "UNSUPPORTED_PORTABILITY",
      "configuration.configuredInfrastructure",
      "Client handoff cannot depend on agency-owned runtime infrastructure",
    ));
  }
  return issues;
}

function portabilityIssues(
  configuration: WebsiteRuntimeConfig,
  modules: readonly HandoffModuleSelection[],
  connectors: readonly HandoffConnectorSelection[],
): readonly ClientHandoffIssue[] {
  const issues: ClientHandoffIssue[] = [];
  const selectedModules = new Map(
    modules.map((selection) => [selection.moduleId, selection]),
  );
  for (const configured of configuration.modules) {
    const selection = selectedModules.get(configured.moduleId);
    if (
      selection === undefined ||
      selection.type !== configured.type ||
      !meaningful(selection.version, 100)
    ) {
      issues.push(issue(
        "MISSING_PORTABILITY_SELECTION",
        `moduleSelections.${configured.moduleId}`,
        "Every configured module requires an exact portable version selection",
      ));
    } else if (selection.portability === "AGENCY_MANAGED") {
      issues.push(issue(
        "UNSUPPORTED_PORTABILITY",
        `moduleSelections.${configured.moduleId}`,
        "Agency-managed module implementations cannot be included in a client handoff",
      ));
    }
  }
  if (selectedModules.size !== configuration.modules.length) {
    issues.push(issue(
      "MISSING_PORTABILITY_SELECTION",
      "moduleSelections",
      "Module selections must exactly match configured modules",
    ));
  }
  if (modules.length !== selectedModules.size) {
    issues.push(issue(
      "MISSING_PORTABILITY_SELECTION",
      "moduleSelections",
      "Module selections cannot contain duplicate identities",
    ));
  }

  const selectedConnectors = new Map(
    connectors.map((selection) => [selection.connectorId, selection]),
  );
  for (const configured of configuration.connectors) {
    const selection = selectedConnectors.get(configured.connectorId);
    if (
      selection === undefined ||
      selection.type !== configured.type ||
      !meaningful(selection.version, 100)
    ) {
      issues.push(issue(
        "MISSING_PORTABILITY_SELECTION",
        `connectorSelections.${configured.connectorId}`,
        "Every configured connector requires an exact portable version selection",
      ));
    } else if (
      selection.portability === "AGENCY_MANAGED" ||
      configured.portability === "AGENCY_MANAGED" ||
      configured.accountOwner !== "CLIENT"
    ) {
      issues.push(issue(
        "UNSUPPORTED_PORTABILITY",
        `connectorSelections.${configured.connectorId}`,
        "Agency-managed connectors cannot be included in a client handoff",
      ));
    }
  }
  if (selectedConnectors.size !== configuration.connectors.length) {
    issues.push(issue(
      "MISSING_PORTABILITY_SELECTION",
      "connectorSelections",
      "Connector selections must exactly match configured connectors",
    ));
  }
  if (connectors.length !== selectedConnectors.size) {
    issues.push(issue(
      "MISSING_PORTABILITY_SELECTION",
      "connectorSelections",
      "Connector selections cannot contain duplicate identities",
    ));
  }
  return issues;
}

function inventory(file: PreparedFile): HandoffFileInventoryRecord {
  return Object.freeze({
    path: file.path,
    category: file.category,
    size: file.content.byteLength,
    sha256: sha256(file.content),
    provenance: Object.freeze({ ...file.provenance }),
  });
}

function generatedFile(path: string, content: string): PreparedFile {
  return Object.freeze({
    path,
    content: toBytes(content),
    category: "GENERATED_HANDOFF",
    provenance: Object.freeze({
      origin: "GENERATED",
      version: generatedVersion,
    }),
  });
}

function exportFile(file: PreparedFile): ClientHandoffExportFile {
  return Object.freeze({
    path: file.path,
    content: new Uint8Array(file.content),
    size: file.content.byteLength,
    sha256: sha256(file.content),
  });
}

function snapshotModules(
  modules: readonly HandoffModuleSelection[],
): readonly HandoffModuleSelection[] {
  return Object.freeze(
    modules.map((selection) => Object.freeze({ ...selection }))
      .sort((left, right) => compareText(left.moduleId, right.moduleId)),
  );
}

function snapshotConnectors(
  connectors: readonly HandoffConnectorSelection[],
): readonly HandoffConnectorSelection[] {
  return Object.freeze(
    connectors.map((selection) => Object.freeze({ ...selection }))
      .sort((left, right) =>
        compareText(left.connectorId, right.connectorId)
      ),
  );
}

function snapshotEnvironment(
  variables: readonly RequiredEnvironmentVariable[],
): readonly RequiredEnvironmentVariable[] {
  return Object.freeze(
    variables.map((variable) => Object.freeze({ ...variable }))
      .sort((left, right) => compareText(left.name, right.name)),
  );
}

function buildExport(
  input: ClientHandoffExportInput,
  configuration: WebsiteRuntimeConfig,
  dependencies: ParsedPackage["dependencies"],
  restorePlan: ClientHandoffManifest["optionalDataRestorePlan"],
): ClientHandoffExport {
  const modules = snapshotModules(input.moduleSelections);
  const connectors = snapshotConnectors(input.connectorSelections);
  const environment = snapshotEnvironment(
    input.requiredEnvironmentVariables,
  );
  const payload: PreparedFile[] = input.artifacts.map((artifact) =>
    Object.freeze({
      path: artifact.path,
      content: toBytes(artifact.content),
      category: artifact.category,
      provenance: Object.freeze({ ...artifact.provenance }),
    })
  );
  const manifestBase: ClientHandoffManifest = {
    schemaVersion: 1,
    clientId: configuration.clientId,
    deploymentId: configuration.deploymentId,
    configurationId: configuration.configurationId,
    configurationVersion: configuration.configurationVersion,
    repositoryName: input.repositoryName,
    exportedAt: input.exportedAt,
    ownership: {
      sourceRepository: "CLIENT",
      hosting: "CLIENT",
      analytics: "CLIENT",
      domains: "CLIENT",
    },
    domains: Object.freeze(
      configuration.domains.map((domain) => Object.freeze({ ...domain }))
        .sort((left, right) => compareText(left.hostname, right.hostname)),
    ),
    requiredEnvironmentVariables: environment,
    includedFiles: Object.freeze([]),
    includedAssets: Object.freeze([]),
    modules,
    connectors,
    publicDependencies: Object.freeze(
      dependencies.map((dependency) => Object.freeze({ ...dependency })),
    ),
    buildProvenance: Object.freeze({
      applicationVersion: input.deploymentManifest.applicationVersion,
      buildId: input.deploymentManifest.buildProvenance.buildId,
      sourceRevision:
        input.deploymentManifest.buildProvenance.sourceRevision,
      generatedAt: input.deploymentManifest.buildProvenance.generatedAt,
    }),
    optionalDataRestorePlan: restorePlan,
    verification: Object.freeze({
      packageManager: "pnpm@11.9.0",
      nodeVersion: "24.18.0",
      integrityAlgorithm: "SHA256",
      manifestDigestPath: HANDOFF_MANIFEST_DIGEST_PATH,
      verifierPath: "scripts/verify-handoff.mjs",
      commands: Object.freeze([
        "pnpm install --frozen-lockfile --ignore-scripts",
        "pnpm typecheck",
        "pnpm build",
        "pnpm test",
        "pnpm verify:handoff",
      ] as const),
    }),
    scans: Object.freeze({
      privateDependencies: "PASSED",
      secrets: "PASSED",
      clientIsolation: "PASSED",
    }),
  };

  const generated: PreparedFile[] = [
    generatedFile(
      ".env.example",
      environmentExample(environment),
    ),
    generatedFile(
      "HANDOFF-CHECKLIST.md",
      handoffChecklist(manifestBase),
    ),
    generatedFile("README.md", handoffReadme(manifestBase)),
    generatedFile(
      "scripts/verify-handoff.mjs",
      portableVerifierSource(),
    ),
  ];
  const includedFiles = Object.freeze(
    [...payload, ...generated]
      .sort((left, right) => compareText(left.path, right.path))
      .map(inventory),
  );
  const manifest: ClientHandoffManifest = Object.freeze({
    ...manifestBase,
    includedFiles,
    includedAssets: Object.freeze(
      includedFiles.filter(({ category }) => category === "ASSET"),
    ),
  });
  const manifestContent = jsonFile(manifest);
  const manifestDigest = sha256(manifestContent);
  const complete: PreparedFile[] = [
    ...payload,
    ...generated,
    Object.freeze({
      path: HANDOFF_MANIFEST_PATH,
      content: manifestContent,
      category: "GENERATED_HANDOFF",
      provenance: Object.freeze({
        origin: "GENERATED",
        version: generatedVersion,
      }),
    }),
    generatedFile(
      HANDOFF_MANIFEST_DIGEST_PATH,
      `${manifestDigest}\n`,
    ),
  ];
  return Object.freeze({
    repositoryName: input.repositoryName,
    exportedAt: input.exportedAt,
    manifest,
    manifestDigest,
    files: Object.freeze(
      complete
        .sort((left, right) => compareText(left.path, right.path))
        .map(exportFile),
    ),
  });
}

export function createClientHandoffExport(
  input: ClientHandoffExportInput,
): ClientHandoffExportResult {
  if (!validInputEnvelope(input)) {
    return Object.freeze({
      success: false,
      issues: Object.freeze([
        issue(
          "INVALID_HANDOFF_INPUT",
          ".",
          "Client handoff input is incomplete or malformed",
        ),
      ]),
    });
  }
  const configuration = validateWebsiteRuntimeConfig(input.configuration);
  if (!configuration.success) {
    return Object.freeze({
      success: false,
      issues: Object.freeze([
        issue(
          "INVALID_HANDOFF_INPUT",
          "configuration",
          "Client configuration must pass the shared runtime validator",
        ),
      ]),
    });
  }

  const issues: ClientHandoffIssue[] = [
    ...validateManifestInput(input, configuration.data),
    ...environmentDefinitions(input.requiredEnvironmentVariables),
    ...portabilityIssues(
      configuration.data,
      input.moduleSelections,
      input.connectorSelections,
    ),
    ...validateArtifactBoundary(
      input,
      configuration.data.clientId,
    ),
  ];
  const packageArtifact = input.artifacts.find(({ path }) =>
    path === "package.json"
  );
  const packageResult = parsePackageJson(
    packageArtifact,
    input.repositoryName,
    input.publicDependencyAllowlist,
  );
  issues.push(...packageResult.issues);
  issues.push(
    ...validateLockfile(
      input.artifacts.find(({ path }) => path === "pnpm-lock.yaml"),
    ),
  );
  issues.push(
    ...validateGitIgnore(
      input.artifacts.find(({ path }) => path === ".gitignore"),
    ),
  );
  const restorePlan = createOptionalDataRestorePlan(
    configuration.data.configuredInfrastructure,
    input.optionalDataResources,
  );
  if (!restorePlan.success) {
    issues.push(...restorePlan.issues);
  }

  if (
    issues.length > 0 ||
    packageResult.parsed === undefined ||
    !restorePlan.success
  ) {
    return Object.freeze({
      success: false,
      issues: sortedIssues(issues),
    });
  }
  return Object.freeze({
    success: true,
    export: buildExport(
      input,
      configuration.data,
      packageResult.parsed.dependencies,
      restorePlan.data,
    ),
  });
}
