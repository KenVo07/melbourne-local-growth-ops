/**
 * Atomic publication and integrity inventory for the three premium commands.
 *
 * Every command here writes a directory an operator will later trust: a
 * workspace a design session is built from, a launch pack a production agent
 * executes, a report a human signs a ship decision against. A half-written one
 * of those is worse than none, because it looks finished. So each command
 * builds into a sibling temporary directory and renames it into place in one
 * step, and a failure anywhere removes the temporary directory and leaves the
 * requested output absent.
 *
 * The read-only permissions set on a published baseline are ergonomics, not
 * security: they stop an accidental edit in the wrong tree. The actual
 * guarantee is the hash inventory, rechecked at launch, and the identity
 * re-derived from the live client input.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { compareText, refuse, sha256 } from "./premium-contracts.mjs";

/**
 * Builds `targetDirectory` in a sibling temporary directory and renames it into
 * place only if `build` returns without throwing.
 *
 * The target may be absent or an existing empty directory — an operator who ran
 * `mkdir` first should not be punished for it — but never a directory holding
 * files. Reusing an output directory is how one run's evidence quietly becomes
 * another run's, so it is refused rather than merged.
 */
export async function publishAtomically(targetDirectory, build) {
  const target = resolve(targetDirectory);
  const targetWasEmptyDirectory = await assertEmptyOrAbsent(target);
  await mkdir(dirname(target), { recursive: true });

  const staging = `${target}.staging-${process.pid}-${randomUUID()}`;
  await mkdir(staging, { recursive: false });
  try {
    const result = await build(staging);
    /* The window between removing an empty target and renaming onto it is the
     * only non-atomic instant in the operation, and it exists only for a target
     * the operator created and left empty. */
    if (targetWasEmptyDirectory) await rmdir(target);
    await rename(staging, target);
    return { target, result };
  } catch (error) {
    await rm(staging, { force: true, recursive: true });
    throw error;
  }
}

/** True when the target is an existing empty directory. */
async function assertEmptyOrAbsent(target) {
  let stats;
  try {
    stats = await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!stats.isDirectory()) {
    throw refuse(
      "OUTPUT_NOT_EMPTY",
      `${target} exists and is not a directory. Choose a new output path; outputs are never overwritten.`,
      { target },
    );
  }
  const entries = await readdir(target);
  if (entries.length > 0) {
    throw refuse(
      "OUTPUT_NOT_EMPTY",
      `${target} already holds ${entries.length} entr${entries.length === 1 ? "y" : "ies"}. Choose a new output path; outputs are never overwritten.`,
      { target, entries: entries.slice(0, 10) },
    );
  }
  return true;
}

/**
 * Resolves a path that a caller supplied, refusing anything that is not a plain
 * directory of regular files and directories.
 *
 * Symlinks are refused rather than followed. A followed symlink is how a path
 * inside a client input reaches another client's source, and the Factory's own
 * source policy refuses them for the same reason.
 */
export async function resolveExistingDirectory(path, label) {
  const resolved = resolve(path);
  let stats;
  try {
    stats = await lstat(resolved);
  } catch {
    throw refuse("INPUT_NOT_FOUND", `${label} does not exist: ${resolved}`, {
      label,
      path: resolved,
    });
  }
  if (stats.isSymbolicLink()) {
    throw refuse("UNSUPPORTED_FILE", `${label} is a symlink: ${resolved}`, {
      label,
      path: resolved,
    });
  }
  if (!stats.isDirectory()) {
    throw refuse("INPUT_NOT_FOUND", `${label} is not a directory: ${resolved}`, {
      label,
      path: resolved,
    });
  }
  return resolved;
}

export async function resolveExistingFile(path, label) {
  const resolved = resolve(path);
  let stats;
  try {
    stats = await lstat(resolved);
  } catch {
    throw refuse("INPUT_NOT_FOUND", `${label} does not exist: ${resolved}`, {
      label,
      path: resolved,
    });
  }
  if (stats.isSymbolicLink()) {
    throw refuse("UNSUPPORTED_FILE", `${label} is a symlink: ${resolved}`, {
      label,
      path: resolved,
    });
  }
  if (!stats.isFile()) {
    throw refuse("INPUT_NOT_FOUND", `${label} is not a file: ${resolved}`, {
      label,
      path: resolved,
    });
  }
  return resolved;
}

/**
 * Every regular file under `root`, as POSIX paths relative to it.
 *
 * Refuses symlinks, devices, sockets and FIFOs outright rather than skipping
 * them, so an inventory can never claim to describe a tree it did not read. A
 * hardlink is indistinguishable from a regular file at this layer; it is caught
 * by content hashing, which is what the inventory is for.
 */
export async function listFiles(root, directory = root, collected = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      await listFiles(root, absolute, collected);
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw refuse(
        "UNSUPPORTED_FILE",
        `${relative(root, absolute)} is a symlink. Premium workspaces carry regular files only.`,
        { path: relative(root, absolute) },
      );
    }
    if (!entry.isFile()) {
      throw refuse(
        "UNSUPPORTED_FILE",
        `${relative(root, absolute)} is not a regular file.`,
        { path: relative(root, absolute) },
      );
    }
    collected.push(relative(root, absolute).replaceAll("\\", "/"));
  }
  return collected.sort(compareText);
}

export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** `{ path, sha256, size }` for every file under `root`, minus `exclude`. */
export async function inventoryDirectory(root, exclude = []) {
  const excluded = new Set(exclude);
  const paths = (await listFiles(root)).filter((path) => !excluded.has(path));
  const entries = [];
  for (const path of paths) {
    const absolute = join(root, ...path.split("/"));
    const stats = await lstat(absolute);
    entries.push({ path, sha256: await hashFile(absolute), size: stats.size });
  }
  return entries;
}

/**
 * The `sha256sum -c` sidecar. It covers every file in the directory except
 * itself, including the manifest, so an operator can check a delivered
 * workspace with a standard tool and no repository checkout.
 *
 * It is an accident detector, not a signature: anyone who can rewrite a file
 * can rewrite this. The tamper check that actually holds is re-deriving the
 * identity from the live client input at launch.
 *
 * **The self-reference rule, now enforced rather than described.** A manifest
 * cannot list itself: its own digest is not knowable until it is written, and
 * writing it changes the file it just measured. A package whose manifest names
 * itself fails `sha256sum -c` forever, on exactly one line, and reads to a
 * reviewer as a corrupted package rather than an impossible instruction. Every
 * Platform-generated pack already excluded the sidecar because each caller
 * remembered to; a hand-assembled closure package did not, which is what turned
 * a documented convention into a defect. The rule now lives in the one function
 * every package goes through.
 */
export async function writeChecksumSidecar(root, name, entries) {
  const selfReferencing = entries.filter((entry) => entry.path === name);
  if (selfReferencing.length > 0) {
    throw refuse(
      "CONTRACT_INVALID",
      `The checksum manifest "${name}" cannot list itself. Its digest is not knowable before it is written, and writing it invalidates the line — strict verification would fail on that one entry forever. Exclude "${name}" when taking the inventory: inventoryDirectory(root, ["${name}"]).`,
      { manifest: name },
    );
  }
  const body = entries
    .map(({ sha256: digest, path }) => `${digest}  ${path}`)
    .join("\n");
  await writeFile(join(root, name), `${body}\n`, "utf8");
}

/** Recomputes hashes for `entries` and names what moved. */
export async function verifyInventory(root, entries) {
  const missing = [];
  const changed = [];
  for (const entry of entries) {
    const absolute = join(root, ...entry.path.split("/"));
    let stats;
    try {
      stats = await lstat(absolute);
    } catch {
      missing.push(entry.path);
      continue;
    }
    if (!stats.isFile() || stats.size !== entry.size) {
      changed.push(entry.path);
      continue;
    }
    if ((await hashFile(absolute)) !== entry.sha256) changed.push(entry.path);
  }
  return Object.freeze({
    intact: missing.length === 0 && changed.length === 0,
    missing: Object.freeze(missing.sort(compareText)),
    changed: Object.freeze(changed.sort(compareText)),
  });
}

/** Writes a file, creating parents, and returns the bytes written. */
export async function writeInto(root, relativePath, contents) {
  const absolute = join(root, ...relativePath.split("/"));
  await mkdir(dirname(absolute), { recursive: true });
  const bytes = typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
  await writeFile(absolute, bytes);
  return bytes;
}

export async function writeJsonInto(root, relativePath, value) {
  return writeInto(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonFile(path, label) {
  const text = await readFile(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw refuse("CONTRACT_INVALID", `${label} is not valid JSON: ${error.message}`, {
      label,
      path,
    });
  }
}

/**
 * Drops write permission on the published files a caller names as immutable,
 * best effort.
 *
 * Files only, never directories: the operator still has to be able to delete
 * the workspace, and the nine creative artifacts still have to be editable, so
 * `keepWritable` prefixes are skipped. A failure here is reported rather than
 * thrown, because a filesystem that cannot express the permission does not
 * invalidate a workspace whose real guarantee is its hashes.
 */
export async function makeReadOnly(root, keepWritable = []) {
  const failures = [];
  const paths = await listFiles(root);
  for (const path of paths) {
    if (keepWritable.some((prefix) => path === prefix || path.startsWith(prefix))) {
      continue;
    }
    try {
      await chmod(join(root, ...path.split("/")), 0o444);
    } catch (error) {
      failures.push(`${path}: ${error.message}`);
    }
  }
  return failures;
}

/** Content identity of a value, for manifests that reference one another. */
export function identityOf(value) {
  return sha256(typeof value === "string" ? value : JSON.stringify(value));
}
