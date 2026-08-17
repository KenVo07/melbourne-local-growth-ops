import type {
  ClientHandoffIssue,
  ClientHandoffIssueCode,
  HandoffArtifactInput,
  RequiredEnvironmentVariable,
} from "./handoff-types.js";
import { compareText, textContent, toBytes } from "./handoff-integrity.js";

const rootFiles = new Set([
  ".gitignore",
  "next.config.mjs",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "vitest.config.mts",
  "vitest.config.ts",
]);
const allowedRoots = new Set(["public", "scripts", "src", "tests"]);
const generatedPaths = new Set([
  ".env.example",
  "HANDOFF-CHECKLIST.md",
  "README.md",
  "handoff-manifest.json",
  "handoff-manifest.sha256",
  "scripts/verify-handoff.mjs",
]);
const forbiddenSegments = new Set([
  ".cache",
  ".git",
  ".next",
  "agency",
  "coverage",
  "dist",
  "factory",
  "internal-tools",
  "node_modules",
  "tooling",
]);
const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const safeSegment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/**
 * Next App Router dynamic segment directories: `[id]`, `[...segments]` and
 * `[[...segments]]`. A multi-route client site cannot be handed off without
 * them. The inner name is restricted to word characters, so a bracketed segment
 * can never express traversal, a separator or whitespace.
 */
const nextDynamicSegment =
  /^\[(?:\[\.\.\.[A-Za-z0-9_]+\]|\.\.\.[A-Za-z0-9_]+|[A-Za-z0-9_]+)\]$/;
const environmentReference =
  /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g;
const builtInEnvironmentNames = new Set(["NODE_ENV"]);

const secretPatterns: readonly RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAuthorization\s*:\s*Bearer\s+\S+/i,
  /\b(?:password|passwd|secret|token|api[_-]?key|apiToken|apiKey|private[_-]?key)\b\s*[:=]\s*["'][^"'\r\n]+["']/i,
  /\b(?:password|passwd|secret|token|api[_-]?key|apiToken|apiKey|private[_-]?key)\b\s*[:=]\s*[A-Za-z0-9_./+=-]{8,}/i,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/,
  /\b(?:re|vcp|npm)_[A-Za-z0-9_-]{12,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{12,}\b/,
  /\bAKIA[A-Z0-9]{12,}\b/,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/,
  /https?:\/\/[^/\s:@]+:[^/\s@]+@/i,
];

const privateDependencyPatterns: readonly RegExp[] = [
  /\bworkspace:/i,
  // A `link:` or `file:` dependency protocol is always followed by a path with
  // no intervening whitespace. Requiring that keeps ordinary source identifiers
  // such as a `Link:` property from reading as a private dependency.
  /(?:^|["'\s,{[])(?:link|file):(?=[^\s"']*[/.])/i,
  /\bgit\+(?:ssh|https?):/i,
  /\bssh:\/\//i,
  /\bgithub:/i,
  /\b@melbourne-local-growth-ops\//i,
  /\b@agency\//i,
  // Registry redirection is only meaningful when the value is a URL. Requiring
  // a scheme or protocol-relative prefix keeps an ordinary `registry:` property
  // or a `context.registry` member access from reading as configuration.
  // `.npmrc` itself is refused outright regardless of content.
  /\b(?:registry|npmRegistryServer)\s*[:=]\s*["']?(?!https:\/\/registry\.npmjs\.org)(?:https?:\/\/|\/\/)/i,
];

export function issue(
  code: ClientHandoffIssueCode,
  path: string,
  message: string,
): ClientHandoffIssue {
  return Object.freeze({ code, path, message });
}

export function sortedIssues(
  issues: readonly ClientHandoffIssue[],
): readonly ClientHandoffIssue[] {
  return Object.freeze(
    [...issues].sort((left, right) =>
      compareText(left.path, right.path) ||
      compareText(left.code, right.code) ||
      compareText(left.message, right.message)
    ),
  );
}

export function isSafeExportPath(path: string): boolean {
  if (
    path.length === 0 ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.includes("//") ||
    generatedPaths.has(path)
  ) {
    return false;
  }
  if (rootFiles.has(path)) {
    return true;
  }
  const segments = path.split("/");
  if (
    segments.some((segment) =>
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment.endsWith(".") ||
      segment.endsWith(" ") ||
      !(safeSegment.test(segment) || nextDynamicSegment.test(segment)) ||
      windowsReserved.test(segment)
    )
  ) {
    return false;
  }
  return segments.length > 1 && allowedRoots.has(segments[0] ?? "");
}

export function isSafeHandoffFilePath(path: string): boolean {
  return generatedPaths.has(path) || isSafeExportPath(path);
}

export function isFactoryPrivatePath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => forbiddenSegments.has(segment.toLowerCase()));
}

export function scanArtifact(
  artifact: HandoffArtifactInput,
  expectedClientId: string,
  otherClientIdentifiers: readonly string[],
  documentedEnvironmentVariables:
    readonly RequiredEnvironmentVariable[],
): readonly ClientHandoffIssue[] {
  const issues: ClientHandoffIssue[] = [];
  if (artifact.clientId !== expectedClientId) {
    issues.push(issue(
      "CLIENT_ISOLATION_VIOLATION",
      artifact.path,
      "Artifact client identity does not match the export client",
    ));
  }

  const content = toBytes(artifact.content);
  if (content.byteLength > 10 * 1024 * 1024) {
    issues.push(issue(
      "INVALID_HANDOFF_INPUT",
      artifact.path,
      "Artifact exceeds the 10 MiB handoff limit",
    ));
    return issues;
  }
  const text = textContent(content);
  if (text === undefined) {
    return issues;
  }
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    issues.push(issue(
      "SECRET_MATERIAL",
      artifact.path,
      "Artifact contains credential-shaped material",
    ));
  }
  if (
    privateDependencyPatterns.some((pattern) => pattern.test(text)) ||
    artifact.path === ".npmrc"
  ) {
    issues.push(issue(
      "PRIVATE_DEPENDENCY",
      artifact.path,
      "Artifact contains a private, workspace, local, or unapproved registry reference",
    ));
  }
  if (
    otherClientIdentifiers.some((identifier) =>
      identifier.length > 0 && text.includes(identifier)
    )
  ) {
    issues.push(issue(
      "CLIENT_ISOLATION_VIOLATION",
      artifact.path,
      "Artifact contains another client's identifier",
    ));
  }

  const documented = new Set(
    documentedEnvironmentVariables.map(({ name }) => name),
  );
  for (const match of text.matchAll(environmentReference)) {
    const name = match[1] ?? match[2];
    if (
      name !== undefined &&
      !documented.has(name) &&
      !builtInEnvironmentNames.has(name)
    ) {
      issues.push(issue(
        "UNDOCUMENTED_ENVIRONMENT_VARIABLE",
        artifact.path,
        `Environment variable ${name} is used but not documented`,
      ));
    }
  }
  return issues;
}

export function privateDependencyReference(value: string): boolean {
  return privateDependencyPatterns.some((pattern) => pattern.test(value));
}

export function containsSecretMaterial(value: string): boolean {
  const normalized = value.replaceAll('\\"', '"').replaceAll("\\'", "'");
  return secretPatterns.some((pattern) =>
    pattern.test(value) || pattern.test(normalized)
  );
}
