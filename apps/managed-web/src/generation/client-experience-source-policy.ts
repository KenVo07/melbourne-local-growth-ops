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

/** Identifiers that reach the network directly, however they are referenced. */
const networkIdentifiers = new Set([
  "fetch",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
  "Worker",
  "SharedWorker",
  "importScripts",
  "sendBeacon",
  "serviceWorker",
  // `new Image().src = "https://…"` is a classic beacon that never calls fetch.
  "Image",
  "Audio",
]);

/** Dynamic code execution, however it is referenced. */
const executionIdentifiers = new Set([
  "eval",
  "require",
  "Function",
  "execScript",
]);

/** Persistent browser state the authored layer must not own. */
const browserStateIdentifiers = new Set([
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "openDatabase",
  "caches",
]);

/** Environment and host access with no legitimate authored use. */
const environmentIdentifiers = new Set(["process"]);

/**
 * Forbidden globals whose names are also ordinary website vocabulary.
 *
 * A Contractor site has a PROCESS section; a retailer has a `history` of the
 * business. An author reaching for the obvious variable name collides with a
 * global, and the refusal has to say so rather than implying the content is at
 * fault. Purely diagnostic: nothing here changes what is refused.
 */
const contentVocabulary = new Set(["process", "history", "location", "status"]);

/** Property names and calls that inject unescaped markup. */
const unsafeMarkupProperties = new Set([
  "innerHTML",
  "outerHTML",
  "insertAdjacentHTML",
  "dangerouslySetInnerHTML",
  "createContextualFragment",
  "write",
  "writeln",
]);

/**
 * Every identifier that is refused in *any* reference position, not only when
 * called. Checking call position alone is defeated by a single cast, an alias
 * or a computed string property.
 */
const forbiddenReferenceNames = new Map<
  string,
  ClientExperienceSourcePolicyErrorCode
>([
  ...[...environmentIdentifiers].map(
    (name) => [name, "ENVIRONMENT_ACCESS_FORBIDDEN"] as const,
  ),
  ...[...executionIdentifiers].map(
    (name) => [name, "EXECUTION_PRIMITIVE_FORBIDDEN"] as const,
  ),
  ...[...networkIdentifiers].map(
    (name) => [name, "NETWORK_ACCESS_FORBIDDEN"] as const,
  ),
  ...[...browserStateIdentifiers].map(
    (name) => [name, "BROWSER_STATE_FORBIDDEN"] as const,
  ),
]);

/** JSX factory functions whose first argument names the element to create. */
const elementFactories = new Set([
  "createElement",
  "jsx",
  "jsxs",
  "jsxDEV",
  "createContextualFragment",
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
  rootDevice?: number,
): Promise<RecursiveSourceFile[]> {
  const device = rootDevice ?? (await lstat(root)).dev;
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
      result.push(...(await recursiveFiles(absolutePath, root, device)));
      continue;
    }
    if (!stats.isFile()) {
      throw new ClientExperienceSourcePolicyError(
        "FILE_TYPE_FORBIDDEN",
        `Client experience source entry "${relativePath}" is not a regular file.`,
        { path: relativePath },
      );
    }
    // A hardlink is indistinguishable from a regular file to lstat, so it would
    // otherwise smuggle a file from outside the root into the artifact.
    if (stats.nlink > 1) {
      throw new ClientExperienceSourcePolicyError(
        "SYMLINK_FORBIDDEN",
        `Client experience source file "${relativePath}" is a hard link. Authored source must contain only regular single-linked files.`,
        { path: relativePath, detail: { links: stats.nlink } },
      );
    }
    if (stats.dev !== device) {
      throw new ClientExperienceSourcePolicyError(
        "PATH_ESCAPE",
        `Client experience source file "${relativePath}" lives on a different device than its source root.`,
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
        "decorators",
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
  // A tag name can be smuggled through a variable: `const Tag = "iframe"`.
  // Collect string-literal bindings up front so a JSX tag or element factory
  // that resolves to a forbidden intrinsic element is still refused.
  const stringBindings = collectStringBindings(program);

  const visit = (node: AstNode, parent: AstNode | undefined): void => {
    switch (node.type) {
      // Babel collects directive prologues into `.directives`, so a `use server`
      // inside a function body is caught here as well as at module scope. The
      // cooked value is used because Babel keeps escapes raw in `value.value`,
      // so `"use serve\u0072"` would otherwise read as a different string.
      case "Directive": {
        const literal = node.value;
        const cooked = isNode(literal)
          ? ((literal.extra as { expressionValue?: unknown } | undefined)
              ?.expressionValue ?? literal.value)
          : undefined;
        if (cooked === "use server") {
          throw new ClientExperienceSourcePolicyError(
            "EXECUTION_PRIMITIVE_FORBIDDEN",
            `Client experience source "${relativePath}" cannot declare use server.`,
            { path: relativePath },
          );
        }
        // Only a module-scope directive makes a file a client component; React
        // ignores one nested in a function body, so honouring it would
        // mis-describe the artifact.
        if (cooked === "use client" && parent === program) {
          clientRuntime = true;
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
        throw new ClientExperienceSourcePolicyError(
          "IMPORT_FORBIDDEN",
          `Client experience source "${relativePath}" cannot use import-equals or import type expressions; use a static import declaration.`,
          { path: relativePath },
        );
      }

      case "MetaProperty": {
        throw new ClientExperienceSourcePolicyError(
          "ENVIRONMENT_ACCESS_FORBIDDEN",
          `Client experience source "${relativePath}" cannot read import.meta.`,
          { path: relativePath },
        );
      }

      case "CallExpression":
      case "NewExpression": {
        const callee = unwrapExpression(node.callee);
        if (!isNode(callee)) break;
        const name = calleeName(callee);
        if (name !== undefined && elementFactories.has(name)) {
          assertSafeElementFactory(node, name, relativePath, stringBindings);
        }
        // `setTimeout("code", 0)` is string eval by another name.
        if (
          (name === "setTimeout" || name === "setInterval") &&
          isStringish(firstArgument(node))
        ) {
          throw new ClientExperienceSourcePolicyError(
            "EXECUTION_PRIMITIVE_FORBIDDEN",
            `Client experience source "${relativePath}" cannot pass a string body to ${name}.`,
            { path: relativePath },
          );
        }
        // `({}).constructor.constructor("…")` reaches Function without naming it.
        if (name === "constructor") {
          throw new ClientExperienceSourcePolicyError(
            "EXECUTION_PRIMITIVE_FORBIDDEN",
            `Client experience source "${relativePath}" cannot invoke a constructor property; it reaches dynamic code execution.`,
            { path: relativePath },
          );
        }
        break;
      }

      case "Identifier": {
        // Only a genuine reference counts. A property name or an object key
        // that happens to read `process` is ordinary client content, and
        // refusing it would make a "Our process" section unauthorable.
        if (!isReferencePosition(node, parent)) break;
        assertAllowedReference(node.name, relativePath, node);
        break;
      }

      case "MemberExpression":
      case "OptionalMemberExpression": {
        const propertyName = staticPropertyName(node);
        if (propertyName === undefined) break;
        // Reaching a forbidden name *through a global container* is the same as
        // naming it: `globalThis["process"]`, `window.localStorage`,
        // `globalThis.eval`. An ordinary property access such as
        // `studio.process` is client content and stays authorable.
        if (isGlobalContainer(node.object)) {
          assertAllowedReference(propertyName, relativePath, node);
        }
        if (
          propertyName === "cookie" &&
          expressionMentions(node.object, "document")
        ) {
          throw new ClientExperienceSourcePolicyError(
            "BROWSER_STATE_FORBIDDEN",
            `Client experience source "${relativePath}" cannot read or write document cookies.`,
            { path: relativePath },
          );
        }
        if (unsafeMarkupProperties.has(propertyName)) {
          throw new ClientExperienceSourcePolicyError(
            "UNSAFE_MARKUP_FORBIDDEN",
            `Client experience source "${relativePath}" cannot use ${propertyName}. Use typed content and reviewed Platform primitives.`,
            { path: relativePath },
          );
        }
        if (networkIdentifiers.has(propertyName)) {
          throw new ClientExperienceSourcePolicyError(
            "NETWORK_ACCESS_FORBIDDEN",
            `Client experience source "${relativePath}" cannot reach ${propertyName}. Use a reviewed Platform module or integration boundary.`,
            { path: relativePath },
          );
        }
        break;
      }

      case "JSXAttribute": {
        const attributeName = isNode(node.name) ? node.name.name : undefined;
        if (
          typeof attributeName === "string" &&
          urlValuedNames.has(attributeName)
        ) {
          const candidate = staticStringValue(node.value);
          if (candidate !== undefined && isDangerousUrlValue(candidate)) {
            throw new ClientExperienceSourcePolicyError(
              "UNSAFE_URL_FORBIDDEN",
              `Client experience source "${relativePath}" sets ${attributeName} to an executable or remote-code URL.`,
              { path: relativePath },
            );
          }
        }
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

      case "ObjectProperty":
      case "ObjectMethod": {
        const keyName = staticKeyName(node);
        if (keyName !== undefined && unsafeMarkupProperties.has(keyName)) {
          throw new ClientExperienceSourcePolicyError(
            "UNSAFE_MARKUP_FORBIDDEN",
            `Client experience source "${relativePath}" cannot use ${keyName}. Use typed content and reviewed Platform primitives.`,
            { path: relativePath },
          );
        }
        if (keyName !== undefined && urlValuedNames.has(keyName)) {
          const candidate = staticStringValue(node.value);
          if (candidate !== undefined && isDangerousUrlValue(candidate)) {
            throw new ClientExperienceSourcePolicyError(
              "UNSAFE_URL_FORBIDDEN",
              `Client experience source "${relativePath}" sets ${keyName} to an executable or remote-code URL.`,
              { path: relativePath },
            );
          }
        }
        // `const { fetch: send } = window` aliases a forbidden global.
        if (
          parent?.type === "ObjectPattern" &&
          keyName !== undefined &&
          forbiddenReferenceNames.has(keyName)
        ) {
          assertAllowedReference(keyName, relativePath);
        }
        break;
      }

      case "JSXOpeningElement":
      case "JSXSelfClosingElement": {
        assertSafeJsxTag(node.name, relativePath, stringBindings);
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

      case "TemplateElement": {
        const cooked = (node.value as { cooked?: unknown } | undefined)?.cooked;
        if (typeof cooked === "string" && isDangerousUrl(cooked)) {
          throw new ClientExperienceSourcePolicyError(
            "UNSAFE_URL_FORBIDDEN",
            `Client experience source "${relativePath}" contains an executable or remote-code URL.`,
            { path: relativePath },
          );
        }
        break;
      }

      case "BinaryExpression": {
        // Fold simple string concatenation so a split scheme is still caught.
        const folded = foldStringConcatenation(node);
        if (folded !== undefined && isDangerousUrl(folded)) {
          throw new ClientExperienceSourcePolicyError(
            "UNSAFE_URL_FORBIDDEN",
            `Client experience source "${relativePath}" builds an executable or remote-code URL by concatenation.`,
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
        for (const item of child) if (isNode(item)) visit(item, node);
      } else if (isNode(child)) {
        visit(child, node);
      }
    }
  };

  /**
   * Refuses a forbidden name and says *which* thing was refused.
   *
   * The policy is deliberately fail-closed: a local binding that merely shadows
   * a forbidden global is refused too, because a shadow cannot be told from the
   * real thing without resolving scope. That is the right behaviour and it does
   * not change here — but it means one message has to serve two operators whose
   * correct next actions are opposite. Somebody who wrote
   * `const process = sections.find(…)` to hold a Contractor's PROCESS section
   * has to rename a variable; somebody who wrote `process.env.SECRET` has to
   * stop. Telling the first "consume validated public inputs instead" sends
   * them to delete content they were already consuming validly.
   *
   * So the message names the global, gives the position, and states the
   * collision case for the names that are also ordinary website vocabulary.
   */
  function assertAllowedReference(
    name: unknown,
    filePath: string,
    node?: AstNode,
  ): void {
    if (typeof name !== "string") return;
    const code = forbiddenReferenceNames.get(name);
    if (code === undefined) return;
    const at = sourcePosition(node);
    throw new ClientExperienceSourcePolicyError(
      code,
      `Client experience source "${filePath}"${at === undefined ? "" : ` (${at})`} cannot use the name ${name}, which is a forbidden global.` +
        (contentVocabulary.has(name)
          ? ` If this is a local binding holding client content, rename it — the ${name.toUpperCase()} section itself is authorable, and only the identifier is refused. A local binding is refused because it cannot be told apart from the global.`
          : "") +
        " Consume validated public inputs and Platform primitives instead.",
      { path: filePath, detail: { name, ...(at === undefined ? {} : { at }) } },
    );
  }

  visit(program, undefined);
  return clientRuntime;
}

/** `line:column` of a parsed node, for messages an operator has to act on. */
function sourcePosition(node: AstNode | undefined): string | undefined {
  // `loc` is not itself an AST node, so it is read structurally.
  const start = (node?.loc as { start?: { line?: unknown; column?: unknown } })
    ?.start;
  const line = start?.line;
  const column = start?.column;
  if (typeof line !== "number" || typeof column !== "number") return undefined;
  return `line ${line}, column ${column + 1}`;
}

/** Strips casts and sequence wrappers so `(eval as any)(...)` still names eval. */
function unwrapExpression(value: unknown): unknown {
  let current = value;
  while (isNode(current)) {
    if (
      current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSTypeAssertion" ||
      current.type === "TSInstantiationExpression" ||
      current.type === "ParenthesizedExpression"
    ) {
      current = current.expression;
      continue;
    }
    if (current.type === "SequenceExpression") {
      const expressions = current.expressions;
      if (!Array.isArray(expressions) || expressions.length === 0) return current;
      current = expressions.at(-1);
      continue;
    }
    return current;
  }
  return current;
}

/** Resolves the simple name of a callee, including `globalThis.eval` forms. */
function calleeName(callee: AstNode): string | undefined {
  if (callee.type === "Identifier" && typeof callee.name === "string") {
    return callee.name;
  }
  if (
    callee.type === "MemberExpression" ||
    callee.type === "OptionalMemberExpression"
  ) {
    return staticPropertyName(callee);
  }
  return undefined;
}

/** The statically known property name of a member expression, if any. */
function staticPropertyName(node: AstNode): string | undefined {
  const property = node.property;
  if (!isNode(property)) return undefined;
  if (node.computed === true) {
    return typeof property.value === "string" ? property.value : undefined;
  }
  return typeof property.name === "string" ? property.name : undefined;
}

/** The statically known key name of an object property or method. */
function staticKeyName(node: AstNode): string | undefined {
  const key = node.key;
  if (!isNode(key)) return undefined;
  if (node.computed === true) {
    return typeof key.value === "string" ? key.value : undefined;
  }
  if (typeof key.name === "string") return key.name;
  return typeof key.value === "string" ? key.value : undefined;
}

/**
 * True when an identifier is used as a value rather than as a label.
 *
 * A non-computed member property or object key that happens to read `process`
 * is ordinary client content — a Contractor site with an "Our process" section
 * must remain authorable — so those positions are not references.
 */
function isReferencePosition(
  node: AstNode,
  parent: AstNode | undefined,
): boolean {
  if (parent === undefined) return true;
  if (
    (parent.type === "MemberExpression" ||
      parent.type === "OptionalMemberExpression") &&
    parent.property === node &&
    parent.computed !== true
  ) {
    return false;
  }
  if (
    (parent.type === "ObjectProperty" ||
      parent.type === "ObjectMethod" ||
      parent.type === "ClassProperty" ||
      parent.type === "ClassMethod" ||
      parent.type === "TSPropertySignature") &&
    parent.key === node &&
    parent.computed !== true
  ) {
    return false;
  }
  if (parent.type === "JSXAttribute" && parent.name === node) return false;
  if (
    (parent.type === "ImportSpecifier" ||
      parent.type === "ExportSpecifier") &&
    parent.imported === node
  ) {
    return false;
  }
  // A local binding that merely shadows the name is not a reference to the
  // global, but treating it as one keeps the policy fail-closed and the name
  // available for content is preserved by the label positions above.
  return true;
}

/**
 * Objects that expose the global scope. A property read through one of these is
 * equivalent to naming the global directly.
 */
const globalContainers = new Set([
  "globalThis",
  "window",
  "self",
  "top",
  "parent",
  "frames",
  "navigator",
  "document",
]);

function isGlobalContainer(expression: unknown): boolean {
  const node = unwrapExpression(expression);
  if (!isNode(node)) return false;
  if (node.type === "Identifier") {
    return typeof node.name === "string" && globalContainers.has(node.name);
  }
  if (
    node.type === "MemberExpression" ||
    node.type === "OptionalMemberExpression"
  ) {
    const name = staticPropertyName(node);
    return (
      (name !== undefined && globalContainers.has(name)) ||
      isGlobalContainer(node.object)
    );
  }
  return false;
}

function firstArgument(node: AstNode): unknown {
  const args = node.arguments;
  return Array.isArray(args) ? args[0] : undefined;
}

function isStringish(value: unknown): boolean {
  if (!isNode(value)) return false;
  return value.type === "StringLiteral" || value.type === "TemplateLiteral";
}

/**
 * Refuses `createElement("script", …)` and the jsx-runtime equivalents. A
 * non-literal element name cannot be proven safe, so it is refused too.
 */
function assertSafeElementFactory(
  node: AstNode,
  factory: string,
  relativePath: string,
  stringBindings: ReadonlyMap<string, string>,
): void {
  if (factory === "createContextualFragment") {
    throw new ClientExperienceSourcePolicyError(
      "UNSAFE_MARKUP_FORBIDDEN",
      `Client experience source "${relativePath}" cannot build markup with createContextualFragment.`,
      { path: relativePath },
    );
  }
  const first = unwrapExpression(firstArgument(node));
  if (!isNode(first)) return;
  if (first.type === "StringLiteral") {
    const tag = String(first.value).toLowerCase();
    if (forbiddenJsxTags.has(tag)) {
      throw new ClientExperienceSourcePolicyError(
        "UNSAFE_MARKUP_FORBIDDEN",
        `Client experience source "${relativePath}" cannot create a raw <${tag}> element through ${factory}. Use the sanctioned Platform primitive.`,
        { path: relativePath, detail: { tag, factory } },
      );
    }
    return;
  }
  if (first.type === "Identifier" && typeof first.name === "string") {
    const bound = stringBindings.get(first.name);
    throw new ClientExperienceSourcePolicyError(
      "UNSAFE_MARKUP_FORBIDDEN",
      bound === undefined
        ? `Client experience source "${relativePath}" cannot pass a non-literal element name to ${factory}; the rendered element cannot be proven safe.`
        : `Client experience source "${relativePath}" cannot create a raw <${bound}> element through ${factory}.`,
      { path: relativePath, detail: { factory } },
    );
  }
  if (first.type === "TemplateLiteral") {
    throw new ClientExperienceSourcePolicyError(
      "UNSAFE_MARKUP_FORBIDDEN",
      `Client experience source "${relativePath}" cannot pass a non-literal element name to ${factory}; the rendered element cannot be proven safe.`,
      { path: relativePath, detail: { factory } },
    );
  }
}

/**
 * Refuses forbidden intrinsic elements and any tag name that is not a plain
 * identifier, because a member, namespaced or variable tag cannot be proven to
 * resolve to a component rather than to a raw element.
 */
function assertSafeJsxTag(
  name: unknown,
  relativePath: string,
  stringBindings: ReadonlyMap<string, string>,
): void {
  if (!isNode(name)) return;
  if (name.type === "JSXIdentifier") {
    const tag = typeof name.name === "string" ? name.name : "";
    // A capitalised name is normally a component reference, but it can be a
    // variable holding an intrinsic tag name.
    if (tag !== tag.toLowerCase()) {
      const bound = stringBindings.get(tag);
      if (bound !== undefined && forbiddenJsxTags.has(bound)) {
        throw new ClientExperienceSourcePolicyError(
          "UNSAFE_MARKUP_FORBIDDEN",
          `Client experience source "${relativePath}" cannot render a raw <${bound}> element through the variable tag "${tag}".`,
          { path: relativePath, detail: { tag: bound } },
        );
      }
      return;
    }
    if (forbiddenJsxTags.has(tag)) {
      throw new ClientExperienceSourcePolicyError(
        "UNSAFE_MARKUP_FORBIDDEN",
        `Client experience source "${relativePath}" cannot render a raw <${tag}> element. Use the sanctioned Platform primitive so route, media and markup validation is not bypassed.`,
        { path: relativePath, detail: { tag } },
      );
    }
    return;
  }
  if (name.type === "JSXNamespacedName") {
    throw new ClientExperienceSourcePolicyError(
      "UNSAFE_MARKUP_FORBIDDEN",
      `Client experience source "${relativePath}" cannot render a namespaced JSX element.`,
      { path: relativePath },
    );
  }
  // JSXMemberExpression such as <H.a> or <this.Foo> resolves at runtime.
  if (name.type === "JSXMemberExpression") {
    const property = name.property;
    const tag =
      isNode(property) && typeof property.name === "string"
        ? property.name
        : "";
    if (tag === tag.toLowerCase() && forbiddenJsxTags.has(tag)) {
      throw new ClientExperienceSourcePolicyError(
        "UNSAFE_MARKUP_FORBIDDEN",
        `Client experience source "${relativePath}" cannot render a raw <${tag}> element through a member expression.`,
        { path: relativePath, detail: { tag } },
      );
    }
  }
}

/**
 * Collects `const X = "literal"` bindings anywhere in the file, so a tag name
 * held in a variable can still be resolved to the element it would render.
 */
function collectStringBindings(program: AstNode): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>();
  const walk = (node: AstNode): void => {
    if (node.type === "VariableDeclarator") {
      const id = node.id;
      const init = unwrapExpression(node.init);
      if (
        isNode(id) &&
        id.type === "Identifier" &&
        typeof id.name === "string" &&
        isNode(init) &&
        init.type === "StringLiteral" &&
        typeof init.value === "string"
      ) {
        bindings.set(id.name, init.value.toLowerCase());
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "extra" || key.endsWith("Comments")) continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isNode(item)) walk(item);
      } else if (isNode(child)) {
        walk(child);
      }
    }
  };
  walk(program);
  return bindings;
}

/** Folds `"a" + "b"` so a split URL scheme is still detected. */
function foldStringConcatenation(node: AstNode): string | undefined {
  if (node.operator !== "+") return undefined;
  const left = literalString(node.left);
  const right = literalString(node.right);
  if (left === undefined || right === undefined) return undefined;
  return `${left}${right}`;
}

function literalString(value: unknown): string | undefined {
  const node = unwrapExpression(value);
  if (!isNode(node)) return undefined;
  if (node.type === "StringLiteral" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "BinaryExpression") return foldStringConcatenation(node);
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

// eslint-disable-next-line no-control-regex -- scheme obfuscation uses these
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** Attribute and property names whose value a browser resolves as a URL. */
const urlValuedNames = new Set([
  "href",
  "src",
  "srcset",
  "action",
  "formaction",
  "poster",
  "data",
  "cite",
  "background",
  "ping",
  "xlinkHref",
  "xlink:href",
]);

/**
 * Normalises a candidate URL the way a browser would before resolving a scheme:
 * control characters, tabs and newlines are ignored anywhere in the value.
 * Spaces and hyphens are preserved because both are meaningful.
 */
function normalizeUrlCandidate(value: string): string {
  return value.replaceAll(CONTROL_CHARACTERS, "").trim().toLowerCase();
}

/**
 * A value that is unambiguously an executable or remote-code URL, wherever it
 * appears. A scheme is only real when nothing separates it from its body, so
 * ordinary prose such as "JavaScript: The Good Parts" is not matched.
 */
function isDangerousUrl(value: string): boolean {
  const normalized = normalizeUrlCandidate(value);
  return (
    /^(?:javascript|vbscript):\S/.test(normalized) ||
    normalized.startsWith("data:text/html")
  );
}

/**
 * The stricter test applied in a position a browser will resolve as a URL. Here
 * even a spaced scheme is refused, because no legitimate href begins that way.
 */
function isDangerousUrlValue(value: string): boolean {
  const normalized = normalizeUrlCandidate(value);
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("vbscript:") ||
    normalized.startsWith("data:text/html")
  );
}

/** Reads a statically known string from a literal, template or concatenation. */
function staticStringValue(value: unknown): string | undefined {
  const node = unwrapExpression(value);
  if (!isNode(node)) return undefined;
  if (node.type === "StringLiteral" && typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "JSXExpressionContainer") {
    return staticStringValue(node.expression);
  }
  if (node.type === "TemplateLiteral") {
    const quasis = node.quasis;
    if (!Array.isArray(quasis)) return undefined;
    return quasis
      .map((quasi) =>
        isNode(quasi)
          ? String((quasi.value as { cooked?: unknown } | undefined)?.cooked ?? "")
          : "",
      )
      .join("");
  }
  if (node.type === "BinaryExpression") return foldStringConcatenation(node);
  return undefined;
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

  // A bare specifier must name a package and an ordinary subpath. Segments such
  // as `motion/../next/link` resolve out of the package and out of the source
  // root, which would defeat both the deny-list and root confinement.
  const segments = specifier.split("/");
  if (
    segments.some(
      (segment, index) =>
        segment === "." ||
        segment === ".." ||
        (segment === "" && index !== segments.length - 1),
    )
  ) {
    throw forbiddenImport(
      sourcePath,
      specifier,
      "A bare import specifier cannot contain path traversal segments.",
    );
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

/**
 * Normalises a stylesheet before pattern matching.
 *
 * CSS ident-sequences accept hex escapes, so `@\69 mport` and `u\72 l(` are
 * honoured by a real CSS parser while a naive regex misses them. Comments are
 * removed first so prose inside a comment is not mistaken for a rule.
 */
function normalizeCssForInspection(sourceText: string): string {
  const withoutComments = sourceText.replaceAll(/\/\*[\s\S]*?\*\//g, " ");
  return withoutComments.replaceAll(
    /\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g,
    (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)),
  );
}

/**
 * Remote-resource forms that are refused. `url()` is the obvious one, but
 * `image-set()` and `src()` both accept a bare string URL, so banning only
 * `url(` leaves an un-reviewed third-party request open.
 */
const cssResourceFunctions = /\b(?:url|image-set|-webkit-image-set|src)\s*\(/i;

/**
 * Resource references a premium authored experience legitimately needs, which
 * carry no third-party request: self-hosted fonts under the client's own public
 * directory, and inline SVG data URIs used for masks, gradients and ornament.
 */
const allowedCssResource =
  /^(?:\/fonts\/[A-Za-z0-9._/-]+|data:image\/svg\+xml[,;][^"')]*)$/i;

function inspectCssSource(sourceText: string, relativePath: string): void {
  const normalized = normalizeCssForInspection(sourceText);

  if (/@import\b/i.test(normalized)) {
    throw new ClientExperienceSourcePolicyError(
      "CSS_RESOURCE_REFERENCE_FORBIDDEN",
      `Client experience stylesheet "${relativePath}" cannot use @import. Import local CSS from TypeScript so every file is inspected explicitly.`,
      { path: relativePath },
    );
  }

  for (const match of normalized.matchAll(
    /\b(url|image-set|-webkit-image-set|src)\s*\(([^)]*)\)/gi,
  )) {
    const rawArguments = match[2] ?? "";
    const references = [...rawArguments.matchAll(/"([^"]*)"|'([^']*)'|([^\s,]+)/g)]
      .map((reference) => reference[1] ?? reference[2] ?? reference[3] ?? "")
      .map((reference) => reference.trim())
      .filter((reference) => reference.length > 0 && !/^\d/.test(reference));
    const offending = references.find(
      (reference) => !allowedCssResource.test(reference),
    );
    if (offending !== undefined) {
      throw new ClientExperienceSourcePolicyError(
        "CSS_RESOURCE_REFERENCE_FORBIDDEN",
        `Client experience stylesheet "${relativePath}" cannot reference "${offending}" through ${match[1]}(). Render validated client media through PlatformImage; only self-hosted /fonts/ files and inline SVG data URIs are permitted.`,
        { path: relativePath, detail: { reference: offending } },
      );
    }
  }

  // A resource function whose arguments could not be read at all is refused,
  // because an unparsed reference cannot be proven safe.
  if (
    cssResourceFunctions.test(normalized) &&
    !/\b(?:url|image-set|-webkit-image-set|src)\s*\([^)]*\)/i.test(normalized)
  ) {
    throw new ClientExperienceSourcePolicyError(
      "CSS_RESOURCE_REFERENCE_FORBIDDEN",
      `Client experience stylesheet "${relativePath}" contains an unreadable resource reference.`,
      { path: relativePath },
    );
  }

  // Legacy IE `expression(...)` appears as a property value, while `behavior`
  // and `-moz-binding` appear as property names, so both shapes are matched.
  if (
    /\bexpression\s*\(/i.test(normalized) ||
    /(?:^|[;{\s])(?:behavior|-moz-binding)\s*:/i.test(normalized)
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
