import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { parse } from "@babel/parser";
import type { ClientExperienceManifest } from "@melbourne-local-growth-ops/site-core";

/**
 * Bare specifiers the Platform always permits. Everything else must be declared
 * by the experience manifest *and* approved by repository governance.
 */
const fixedBareImports = Object.freeze([
  "@proportion/client-experience",
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
]);

/**
 * Packages that are refused regardless of manifest declaration or governance
 * approval, because importing them would bypass a Platform boundary rather than
 * add a capability. `next` is refused wholesale: `next/link` and `next/image`
 * would bypass route and media validation, and `next/headers`, `next/server`
 * and `next/navigation` reach request-time and server primitives.
 */
const alwaysForbiddenPackages = new Set([
  "next",
  "server-only",
  "fs",
  "path",
  "os",
  "child_process",
  "http",
  "https",
  "net",
  "crypto",
  "worker_threads",
  "vm",
  "module",
  "process",
  "react-dom/server",
]);

const forbiddenBareImportPrefixes = Object.freeze([
  "@melbourne-local-growth-ops/",
  "node:",
]);

const forbiddenFileNames = new Set([
  ".env",
  ".env.local",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
]);

const allowedExtensions = new Set([".ts", ".tsx", ".css", ".json"]);

/** Raw DOM elements that would bypass a Platform primitive or inject markup. */
const forbiddenJsxTags = new Set([
  "script",
  "style",
  "link",
  "meta",
  "base",
  "iframe",
  "object",
  "embed",
  "a",
  "img",
  "form",
]);

/** Identifiers that reach the network directly, called or constructed. */
const networkIdentifiers = new Set([
  "fetch",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
  "Worker",
  "SharedWorker",
  "importScripts",
]);

/** Persistent browser state the authored layer must not own. */
const browserStateIdentifiers = new Set([
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "openDatabase",
  "caches",
]);

/** Property names that assign unescaped markup. */
const unsafeMarkupProperties = new Set([
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "dangerouslySetInnerHTML",
]);

export type ClientExperienceSourcePolicyErrorCode =
  | "SOURCE_DIRECTORY_MISSING"
  | "ENTRYPOINT_MISSING"
  | "MANIFEST_MISSING"
  | "SYMLINK_FORBIDDEN"
  | "PATH_ESCAPE"
  | "FILE_TYPE_FORBIDDEN"
  | "FILE_NAME_FORBIDDEN"
  | "SOURCE_PARSE_ERROR"
  | "IMPORT_FORBIDDEN"
  | "DYNAMIC_IMPORT_FORBIDDEN"
  | "EXECUTION_PRIMITIVE_FORBIDDEN"
  | "ENVIRONMENT_ACCESS_FORBIDDEN"
  | "NETWORK_ACCESS_FORBIDDEN"
  | "BROWSER_STATE_FORBIDDEN"
  | "UNSAFE_MARKUP_FORBIDDEN"
  | "UNSAFE_URL_FORBIDDEN"
  | "CSS_RESOURCE_REFERENCE_FORBIDDEN";

export class ClientExperienceSourcePolicyError extends Error {
  readonly code: ClientExperienceSourcePolicyErrorCode;
  readonly path: string | undefined;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(
    code: ClientExperienceSourcePolicyErrorCode,
    message: string,
    options: { path?: string; detail?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "ClientExperienceSourcePolicyError";
    this.code = code;
    this.path = options.path;
    this.detail = Object.freeze({ ...(options.detail ?? {}) });
  }
}

export interface ClientExperienceSourceFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly kind: "SOURCE" | "STYLE" | "DATA" | "MANIFEST";
  readonly clientRuntime: boolean;
}

export interface InspectedClientExperienceSource {
  readonly rootDirectory: string;
  readonly entrypoint: string;
  readonly files: readonly ClientExperienceSourceFile[];
  readonly publicDependencies: readonly string[];
}

export interface InspectClientExperienceSourceOptions {
  readonly inputDirectory: string;
  readonly manifest: ClientExperienceManifest;
  /** Package names already approved by repository governance for this artifact. */
  readonly approvedPublicDependencies: readonly string[];
}

/**
 * Inspects trusted authored client experience source before it is copied into a
 * standalone artifact.
 *
 * This is a build-time control that keeps a trusted-source boundary from
 * degrading into an unbounded filesystem, import or runtime escape hatch. It
 * does not replace human review, typecheck, tests or dependency governance, and
 * it deliberately fails closed: anything it cannot prove safe is refused.
 *
 * Order matters and is fixed: resolve and canonicalize the root, reject
 * symlinks and path escape, require the manifest and entrypoint, check declared
 * dependencies against governance, then parse and inspect every file. Nothing is
 * copied or generated until this function returns.
 */
export async function inspectClientExperienceSource(
  options: InspectClientExperienceSourceOptions,
): Promise<InspectedClientExperienceSource> {
  const rootDirectory = resolve(options.inputDirectory, "experience");
  await assertDirectory(rootDirectory);
  const canonicalRoot = await realpath(rootDirectory);
  const files = await recursiveFiles(canonicalRoot, canonicalRoot);
  const relativePaths = new Set(files.map(({ path }) => path));

  if (!relativePaths.has("manifest.json")) {
    throw new ClientExperienceSourcePolicyError(
      "MANIFEST_MISSING",
      "Client experience source requires experience/manifest.json.",
      { path: "manifest.json" },
    );
  }
  if (!relativePaths.has(options.manifest.entrypoint)) {
    throw new ClientExperienceSourcePolicyError(
      "ENTRYPOINT_MISSING",
      `Client experience source requires ${options.manifest.entrypoint}.`,
      { path: options.manifest.entrypoint },
    );
  }
  if (!relativePaths.has(options.manifest.designDnaPath)) {
    throw new ClientExperienceSourcePolicyError(
      "ENTRYPOINT_MISSING",
      `Client experience source requires ${options.manifest.designDnaPath}.`,
      { path: options.manifest.designDnaPath },
    );
  }

  const declared = new Set(
    options.manifest.publicDependencies.map(({ name }) => name),
  );
  const approved = new Set(options.approvedPublicDependencies);
  for (const dependency of [...declared].sort(compareText)) {
    if (alwaysForbiddenPackages.has(dependency)) {
      throw new ClientExperienceSourcePolicyError(
        "IMPORT_FORBIDDEN",
        `Public dependency "${dependency}" can never be declared by client experience source; it bypasses a Platform boundary.`,
        { detail: { dependency } },
      );
    }
    if (!approved.has(dependency)) {
      throw new ClientExperienceSourcePolicyError(
        "IMPORT_FORBIDDEN",
        `Public dependency "${dependency}" is not approved by repository governance for this artifact.`,
        { detail: { dependency } },
      );
    }
  }

  const inspected = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(file.absolutePath);
      const text = content.toString("utf8");
      const extension = extname(file.path);
      let clientRuntime = false;
      if (extension === ".ts" || extension === ".tsx") {
        clientRuntime = inspectTypeScriptSource(
          text,
          file.path,
          canonicalRoot,
          declared,
          relativePaths,
        );
      } else if (extension === ".css") {
        inspectCssSource(text, file.path);
      }
      return Object.freeze({
        path: file.path,
        size: content.byteLength,
        sha256: createHash("sha256").update(content).digest("hex"),
        kind: kindFor(file.path),
        clientRuntime,
      });
    }),
  );

  return Object.freeze({
    rootDirectory: canonicalRoot,
    entrypoint: options.manifest.entrypoint,
    files: Object.freeze(
      inspected.sort((left, right) => compareText(left.path, right.path)),
    ),
    publicDependencies: Object.freeze([...declared].sort(compareText)),
  });
}

interface RecursiveSourceFile {
  readonly absolutePath: string;
  readonly path: string;
}

async function recursiveFiles(
  directory: string,
  root: string,
): Promise<RecursiveSourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: RecursiveSourceFile[] = [];
  for (const entry of entries.sort((left, right) =>
    compareText(left.name, right.name),
  )) {
    const absolutePath = join(directory, entry.name);
    const stats = await lstat(absolutePath);
    const relativePath = normalizeRelativePath(relative(root, absolutePath));
    if (stats.isSymbolicLink()) {
      throw new ClientExperienceSourcePolicyError(
        "SYMLINK_FORBIDDEN",
        `Client experience source cannot contain symlink "${relativePath}".`,
        { path: relativePath },
      );
    }
    assertInsideRoot(absolutePath, root, relativePath);
    if (stats.isDirectory()) {
      result.push(...(await recursiveFiles(absolutePath, root)));
      continue;
    }
    if (!stats.isFile()) {
      throw new ClientExperienceSourcePolicyError(
        "FILE_TYPE_FORBIDDEN",
        `Client experience source entry "${relativePath}" is not a regular file.`,
        { path: relativePath },
      );
    }
    assertAllowedFile(relativePath);
    result.push(Object.freeze({ absolutePath, path: relativePath }));
  }
  return result;
}

/** Minimal Babel node shape. The walker only needs a discriminant. */
interface AstNode {
  readonly type: string;
  readonly [key: string]: unknown;
}

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function inspectTypeScriptSource(
  sourceText: string,
  relativePath: string,
  root: string,
  declaredDependencies: ReadonlySet<string>,
  knownFiles: ReadonlySet<string>,
): boolean {
  let program: AstNode;
  try {
    // errorRecovery stays off: a file the parser cannot fully understand is a
    // file this policy cannot vouch for.
    program = parse(sourceText, {
      sourceType: "module",
      errorRecovery: false,
      plugins: [
        "typescript",
        ...(relativePath.endsWith(".tsx") ? (["jsx"] as const) : []),
      ],
    }).program as unknown as AstNode;
  } catch (error) {
    throw new ClientExperienceSourcePolicyError(
      "SOURCE_PARSE_ERROR",
      `Client experience source "${relativePath}" has TypeScript parse errors.`,
      {
        path: relativePath,
        detail: {
          diagnostics: [
            error instanceof Error ? error.message : String(error),
          ],
        },
      },
    );
  }

  let clientRuntime = false;

  const visit = (node: AstNode): void => {
    switch (node.type) {
      // Babel collects directive prologues into `.directives`, so a `use server`
      // inside a function body is caught here as well as at module scope.
      case "Directive": {
        const value = (node.value as { value?: unknown } | undefined)?.value;
        if (value === "use client") clientRuntime = true;
        if (value === "use server") {
          throw new ClientExperienceSourcePolicyError(
            "EXECUTION_PRIMITIVE_FORBIDDEN",
            `Client experience source "${relativePath}" cannot declare use server.`,
            { path: relativePath },
          );
        }
        break;
      }

      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration": {
        const source = node.source;
        if (isNode(source) && typeof source.value === "string") {
          validateImportSpecifier(
            source.value,
            relativePath,
            root,
            declaredDependencies,
            knownFiles,
          );
        }
        break;
      }

      case "ImportExpression": {
        const source = node.source;
        if (!isNode(source) || source.type !== "StringLiteral") {
          throw new ClientExperienceSourcePolicyError(
            "DYNAMIC_IMPORT_FORBIDDEN",
            `Dynamic import in "${relativePath}" must use a static string literal.`,
            { path: relativePath },
          );
        }
        validateImportSpecifier(
          source.value as string,
          relativePath,
          root,
          declaredDependencies,
          knownFiles,
        );
        break;
      }

      case "TSImportType":
      case "TSExternalModuleReference": {
        // `import("x")` in type position and `import x = require("y")`.
        throw new ClientExperienceSourcePolicyError(
          "IMPORT_FORBIDDEN",
          `Client experience source "${relativePath}" cannot use import-equals or import type expressions; use a static import declaration.`,
          { path: relativePath },
        );
      }

      case "CallExpression":
      case "NewExpression": {
        const callee = node.callee;
        if (!isNode(callee)) break;
        const name = calleeName(callee);
        if (name === undefined) break;
        if (["eval", "require", "Function", "execScript"].includes(name)) {
          throw new ClientExperienceSourcePolicyError(
            "EXECUTION_PRIMITIVE_FORBIDDEN",
            `Client experience source "${relativePath}" cannot use ${name}. Dynamic code execution is not available to authored client source.`,
            { path: relativePath },
          );
        }
        if (networkIdentifiers.has(name) || name === "sendBeacon") {
          throw new ClientExperienceSourcePolicyError(
            "NETWORK_ACCESS_FORBIDDEN",
            `Client experience source "${relativePath}" cannot perform direct network I/O via ${name}. Use a reviewed Platform module or integration boundary.`,
            { path: relativePath },
          );
        }
        if (unsafeMarkupProperties.has(name)) {
          throw new ClientExperienceSourcePolicyError(
            "UNSAFE_MARKUP_FORBIDDEN",
            `Client experience source "${relativePath}" cannot call ${name}.`,
            { path: relativePath },
          );
        }
        break;
      }

      case "Identifier": {
        const name = node.name;
        // `process` has no legitimate use in authored client source, so every
        // reference is refused rather than only the `process.env` shapes.
        if (name === "process") {
          throw new ClientExperienceSourcePolicyError(
            "ENVIRONMENT_ACCESS_FORBIDDEN",
            `Client experience source "${relativePath}" cannot reference process. Use validated public inputs or a Platform-owned module boundary.`,
            { path: relativePath },
          );
        }
        if (typeof name === "string" && browserStateIdentifiers.has(name)) {
          throw new ClientExperienceSourcePolicyError(
            "BROWSER_STATE_FORBIDDEN",
            `Client experience source "${relativePath}" cannot access ${name}. Persistent browser state is not owned by the authored layer.`,
            { path: relativePath },
          );
        }
        break;
      }

      case "MemberExpression":
      case "OptionalMemberExpression": {
        const property = node.property;
        const propertyName = isNode(property)
          ? typeof property.name === "string"
            ? property.name
            : typeof property.value === "string"
              ? property.value
              : undefined
          : undefined;
        if (propertyName === undefined) break;
        if (propertyName === "cookie" && expressionMentions(node.object, "document")) {
          throw new ClientExperienceSourcePolicyError(
            "BROWSER_STATE_FORBIDDEN",
            `Client experience source "${relativePath}" cannot read or write document cookies.`,
            { path: relativePath },
          );
        }
        if (unsafeMarkupProperties.has(propertyName)) {
          throw new ClientExperienceSourcePolicyError(
            "UNSAFE_MARKUP_FORBIDDEN",
            `Client experience source "${relativePath}" cannot assign ${propertyName}. Use typed content and reviewed Platform primitives.`,
            { path: relativePath },
          );
        }
        break;
      }

      case "JSXAttribute": {
        const attributeName = isNode(node.name) ? node.name.name : undefined;
        if (
          typeof attributeName === "string" &&
          unsafeMarkupProperties.has(attributeName)
        ) {
          throw new ClientExperienceSourcePolicyError(
            "UNSAFE_MARKUP_FORBIDDEN",
            `Client experience source "${relativePath}" cannot use ${attributeName}. Use typed content and reviewed Platform primitives.`,
            { path: relativePath },
          );
        }
        break;
      }

      case "ObjectProperty": {
        const key = node.key;
        const keyName = isNode(key)
          ? typeof key.name === "string"
            ? key.name
            : typeof key.value === "string"
              ? key.value
              : undefined
          : undefined;
        if (keyName !== undefined && unsafeMarkupProperties.has(keyName)) {
          throw new ClientExperienceSourcePolicyError(
            "UNSAFE_MARKUP_FORBIDDEN",
            `Client experience source "${relativePath}" cannot use ${keyName}. Use typed content and reviewed Platform primitives.`,
            { path: relativePath },
          );
        }
        break;
      }

      case "JSXOpeningElement": {
        const tag = jsxTagName(node.name);
        // Lowercase names are intrinsic DOM elements. Component references such
        // as `platform.Link` or `ProjectReveal` are not intrinsic and are fine.
        if (
          tag !== undefined &&
          tag === tag.toLowerCase() &&
          forbiddenJsxTags.has(tag)
        ) {
          throw new ClientExperienceSourcePolicyError(
            "UNSAFE_MARKUP_FORBIDDEN",
            `Client experience source "${relativePath}" cannot render a raw <${tag}> element. Use the sanctioned Platform primitive so route, media and markup validation is not bypassed.`,
            { path: relativePath, detail: { tag } },
          );
        }
        break;
      }

      case "StringLiteral": {
        const value = node.value;
        if (typeof value === "string" && isDangerousUrl(value)) {
          throw new ClientExperienceSourcePolicyError(
            "UNSAFE_URL_FORBIDDEN",
            `Client experience source "${relativePath}" contains an executable or remote-code URL.`,
            { path: relativePath },
          );
        }
        break;
      }

      default:
        break;
    }

    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "extra" || key.endsWith("Comments")) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isNode(item)) visit(item);
      } else if (isNode(child)) {
        visit(child);
      }
    }
  };

  visit(program);
  return clientRuntime;
}

/** Resolves the simple name of a callee, including `globalThis.eval` forms. */
function calleeName(callee: AstNode): string | undefined {
  if (callee.type === "Identifier" && typeof callee.name === "string") {
    return callee.name;
  }
  if (
    (callee.type === "MemberExpression" ||
      callee.type === "OptionalMemberExpression") &&
    isNode(callee.property)
  ) {
    const property = callee.property;
    if (typeof property.name === "string") return property.name;
    if (typeof property.value === "string") return property.value;
  }
  return undefined;
}

/** True when an expression chain names the given identifier anywhere. */
function expressionMentions(expression: unknown, identifier: string): boolean {
  if (!isNode(expression)) return false;
  if (expression.type === "Identifier") return expression.name === identifier;
  if (
    expression.type === "MemberExpression" ||
    expression.type === "OptionalMemberExpression"
  ) {
    return (
      expressionMentions(expression.object, identifier) ||
      (isNode(expression.property) && expression.property.name === identifier)
    );
  }
  return false;
}

function jsxTagName(name: unknown): string | undefined {
  if (!isNode(name)) return undefined;
  if (name.type === "JSXIdentifier" && typeof name.name === "string") {
    return name.name;
  }
  return undefined;
}

function isDangerousUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase().replaceAll(/[\s -]/g, "");
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:") ||
    normalized.startsWith("data:text/html")
  );
}

function validateImportSpecifier(
  specifier: string,
  sourcePath: string,
  root: string,
  declaredDependencies: ReadonlySet<string>,
  knownFiles: ReadonlySet<string>,
): void {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    if (isAbsolute(specifier)) {
      throw forbiddenImport(
        sourcePath,
        specifier,
        "Absolute imports are forbidden.",
      );
    }
    const sourceDirectory = dirname(join(root, ...sourcePath.split("/")));
    const resolved = resolve(sourceDirectory, specifier);
    assertInsideRoot(resolved, root, sourcePath);
    const relativeTarget = normalizeRelativePath(relative(root, resolved));
    if (!couldResolveLocalImport(relativeTarget, knownFiles)) {
      throw forbiddenImport(
        sourcePath,
        specifier,
        `Relative import does not resolve to an inspected client-experience file: ${relativeTarget}.`,
      );
    }
    return;
  }

  const packageRoot = packageNameFor(specifier);
  if (
    forbiddenBareImportPrefixes.some((prefix) => specifier.startsWith(prefix))
  ) {
    throw forbiddenImport(
      sourcePath,
      specifier,
      "Private workspace and Node built-in imports are forbidden.",
    );
  }
  if (
    alwaysForbiddenPackages.has(packageRoot) ||
    alwaysForbiddenPackages.has(specifier)
  ) {
    throw forbiddenImport(
      sourcePath,
      specifier,
      `Package "${packageRoot}" bypasses a Platform boundary and can never be imported by client experience source, even if declared. Consume routes, media and modules through @proportion/client-experience.`,
    );
  }
  if (fixedBareImports.includes(specifier)) return;
  if (!declaredDependencies.has(packageRoot)) {
    throw forbiddenImport(
      sourcePath,
      specifier,
      `Bare import package "${packageRoot}" is not declared in the client experience manifest.`,
    );
  }
}

function inspectCssSource(sourceText: string, relativePath: string): void {
  if (/@import\b/i.test(sourceText)) {
    throw new ClientExperienceSourcePolicyError(
      "CSS_RESOURCE_REFERENCE_FORBIDDEN",
      `Client experience stylesheet "${relativePath}" cannot use @import. Import local CSS from TypeScript so every file is inspected explicitly.`,
      { path: relativePath },
    );
  }
  if (/url\s*\(/i.test(sourceText)) {
    throw new ClientExperienceSourcePolicyError(
      "CSS_RESOURCE_REFERENCE_FORBIDDEN",
      `Client experience stylesheet "${relativePath}" cannot use CSS url(). Render validated client media through PlatformImage instead.`,
      { path: relativePath },
    );
  }
  // Legacy IE `expression(...)` appears as a property *value*, while `behavior`
  // and `-moz-binding` appear as property names, so both shapes are matched.
  if (
    /\bexpression\s*\(/i.test(sourceText) ||
    /(?:^|[;{\s])(?:behavior|-moz-binding)\s*:/i.test(sourceText)
  ) {
    throw new ClientExperienceSourcePolicyError(
      "EXECUTION_PRIMITIVE_FORBIDDEN",
      `Client experience stylesheet "${relativePath}" contains a forbidden legacy execution primitive.`,
      { path: relativePath },
    );
  }
}

function assertAllowedFile(relativePath: string): void {
  const baseName = relativePath.split("/").at(-1) ?? relativePath;
  if (forbiddenFileNames.has(baseName) || baseName.startsWith(".env")) {
    throw new ClientExperienceSourcePolicyError(
      "FILE_NAME_FORBIDDEN",
      `Client experience source cannot contain "${relativePath}".`,
      { path: relativePath },
    );
  }
  if (
    relativePath.startsWith("node_modules/") ||
    relativePath.startsWith(".git/") ||
    relativePath.startsWith(".next/") ||
    relativePath.includes("/app/api/") ||
    relativePath.startsWith("app/api/") ||
    relativePath.includes("/server/") ||
    relativePath.startsWith("server/")
  ) {
    throw new ClientExperienceSourcePolicyError(
      "FILE_NAME_FORBIDDEN",
      `Client experience source path "${relativePath}" crosses a forbidden runtime boundary.`,
      { path: relativePath },
    );
  }
  if (!allowedExtensions.has(extname(relativePath))) {
    throw new ClientExperienceSourcePolicyError(
      "FILE_TYPE_FORBIDDEN",
      `Client experience source file "${relativePath}" has an unsupported extension.`,
      { path: relativePath },
    );
  }
}

async function assertDirectory(directory: string): Promise<void> {
  try {
    const stats = await lstat(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("not-directory");
    }
  } catch {
    throw new ClientExperienceSourcePolicyError(
      "SOURCE_DIRECTORY_MISSING",
      `Client experience directory "${directory}" is missing or invalid.`,
      { path: directory },
    );
  }
}

function assertInsideRoot(
  candidate: string,
  root: string,
  displayPath: string,
): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new ClientExperienceSourcePolicyError(
      "PATH_ESCAPE",
      `Client experience path "${displayPath}" escapes its fixed source root.`,
      { path: displayPath },
    );
  }
}

function couldResolveLocalImport(
  relativeTarget: string,
  knownFiles: ReadonlySet<string>,
): boolean {
  const candidates = [
    relativeTarget,
    `${relativeTarget}.ts`,
    `${relativeTarget}.tsx`,
    `${relativeTarget}.json`,
    `${relativeTarget}.css`,
    `${relativeTarget}/index.ts`,
    `${relativeTarget}/index.tsx`,
  ];
  return candidates.some((candidate) => knownFiles.has(candidate));
}

function packageNameFor(specifier: string): string {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/", 1)[0] ?? specifier;
}

function forbiddenImport(
  sourcePath: string,
  specifier: string,
  reason: string,
): ClientExperienceSourcePolicyError {
  return new ClientExperienceSourcePolicyError(
    "IMPORT_FORBIDDEN",
    `Import "${specifier}" in "${sourcePath}" is forbidden. ${reason}`,
    { path: sourcePath, detail: { specifier } },
  );
}

function kindFor(path: string): ClientExperienceSourceFile["kind"] {
  if (path === "manifest.json") return "MANIFEST";
  if (path.endsWith(".css")) return "STYLE";
  if (path.endsWith(".json")) return "DATA";
  return "SOURCE";
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
