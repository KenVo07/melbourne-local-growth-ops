import {
  mkdir,
  lstat,
  readdir,
  readFile,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { sha256 } from "./handoff-integrity.js";
import { issue, sortedIssues } from "./handoff-scanner.js";
import type {
  ClientHandoffDirectoryResult,
  ClientHandoffExport,
  ClientHandoffExportFile,
  ClientHandoffVerificationResult,
} from "./handoff-types.js";
import { verifyClientHandoffExport } from "./handoff-verification.js";

function containedPath(root: string, filePath: string): string | undefined {
  const target = resolve(root, ...filePath.split("/"));
  const fromRoot = relative(root, target);
  if (
    fromRoot === "" ||
    fromRoot.startsWith(`..${sep}`) ||
    fromRoot === ".." ||
    isAbsolute(fromRoot)
  ) {
    return undefined;
  }
  return target;
}

async function directoryEntries(path: string): Promise<readonly string[] | undefined> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory()) {
      return undefined;
    }
    return await readdir(path);
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

/**
 * Materializes a validated handoff export into an empty directory.
 *
 * The function never replaces existing files and never removes a destination
 * after a partial I/O failure. Callers therefore retain the evidence needed to
 * diagnose or safely discard a failed export.
 */
export async function writeClientHandoffDirectory(
  exported: ClientHandoffExport,
  destination: string,
): Promise<ClientHandoffDirectoryResult> {
  const verification = verifyClientHandoffExport(exported.files);
  if (!verification.success) {
    return verification;
  }
  const manifestFile = exported.files.find(({ path }) =>
    path === "handoff-manifest.json"
  );
  if (
    manifestFile === undefined ||
    exported.manifestDigest !== sha256(manifestFile.content) ||
    exported.exportedAt !== verification.manifest.exportedAt ||
    exported.repositoryName !== verification.manifest.repositoryName ||
    JSON.stringify(exported.manifest) !== JSON.stringify(verification.manifest)
  ) {
    return Object.freeze({
      success: false,
      issues: Object.freeze([
        issue(
          "INTEGRITY_MISMATCH",
          "handoff-manifest.json",
          "Export metadata does not match its validated manifest",
        ),
      ]),
    });
  }
  const root = resolve(destination);
  try {
    const entries = await directoryEntries(root);
    if (entries === undefined || entries.length > 0) {
      return Object.freeze({
        success: false,
        issues: Object.freeze([
          issue(
            "EXPORT_DIRECTORY_NOT_EMPTY",
            ".",
            "Handoff destination must be an empty directory",
          ),
        ]),
      });
    }
    await mkdir(root, { recursive: true });
    const timestamp = new Date(verification.manifest.exportedAt);
    for (const file of [...exported.files].sort((left, right) =>
      left.path.localeCompare(right.path, "en")
    )) {
      const target = containedPath(root, file.path);
      if (target === undefined) {
        return Object.freeze({
          success: false,
          issues: Object.freeze([
            issue(
              "UNSAFE_EXPORT_PATH",
              file.path,
              "Export file resolved outside the handoff destination",
            ),
          ]),
        });
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, { flag: "wx" });
      await utimes(target, timestamp, timestamp);
    }
    return Object.freeze({
      success: true,
      directory: root,
      fileCount: exported.files.length,
      manifestDigest: exported.manifestDigest,
    });
  } catch {
    return Object.freeze({
      success: false,
      issues: Object.freeze([
        issue(
          "EXPORT_IO_FAILED",
          ".",
          "Unable to materialize the handoff repository",
        ),
      ]),
    });
  }
}

async function readDirectoryFiles(
  root: string,
  current: string,
  state: { count: number },
): Promise<readonly ClientHandoffExportFile[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: ClientHandoffExportFile[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en")
  )) {
    const target = resolve(current, entry.name);
    const fromRoot = relative(root, target);
    const portablePath = fromRoot.split(sep).join("/");
    if (
      fromRoot.startsWith(`..${sep}`) ||
      fromRoot === ".." ||
      isAbsolute(fromRoot)
    ) {
      throw new Error("unsafe directory entry");
    }
    if (entry.isDirectory()) {
      files.push(...await readDirectoryFiles(root, target, state));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error("unsupported directory entry");
    }
    state.count += 1;
    const metadata = await stat(target);
    if (state.count > 550 || metadata.size > 10 * 1024 * 1024) {
      throw new Error("handoff directory limit exceeded");
    }
    const content = new Uint8Array(await readFile(target));
    files.push(Object.freeze({
      path: portablePath,
      content,
      size: content.byteLength,
      sha256: sha256(content),
    }));
  }
  return files;
}

/**
 * Verifies the exact transferred directory before install or build output is
 * introduced. Symlinks and other special filesystem entries fail closed.
 */
export async function verifyClientHandoffDirectory(
  directory: string,
): Promise<ClientHandoffVerificationResult> {
  const root = resolve(directory);
  try {
    const metadata = await lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("not a directory");
    }
    const files = await readDirectoryFiles(root, root, { count: 0 });
    return verifyClientHandoffExport(files);
  } catch {
    return Object.freeze({
      success: false,
      issues: sortedIssues([
        issue(
          "RECOVERY_VERIFICATION_FAILED",
          ".",
          "Transferred handoff directory could not be verified",
        ),
      ]),
    });
  }
}
