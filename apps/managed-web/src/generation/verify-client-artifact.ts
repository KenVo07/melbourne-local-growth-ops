import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { createIsolatedBuildEnvironment } from "./build-environment";

export interface ClientSourceVerificationResult {
  readonly success: true;
  readonly checks: readonly ["INSTALL", "TYPECHECK", "TEST", "BUILD"];
  readonly outputPolicy: "TEMPORARY_ONLY";
}

export async function verifyClientSourceArtifact(
  sourceDirectory: string,
): Promise<ClientSourceVerificationResult> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "mlgo-client-build-"));
  const repository = join(temporaryRoot, "repository");
  try {
    await cp(sourceDirectory, repository, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await runPnpm(repository, [
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
    ]);
    await runPnpm(repository, ["typecheck"]);
    await runPnpm(repository, ["test"]);
    await runPnpm(repository, ["build"]);
    await verifyFoundationSearchOutput(repository);

    return Object.freeze({
      success: true,
      checks: Object.freeze(
        ["INSTALL", "TYPECHECK", "TEST", "BUILD"] as const,
      ),
      outputPolicy: "TEMPORARY_ONLY",
    });
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function verifyFoundationSearchOutput(repository: string): Promise<void> {
  const snapshot = JSON.parse(
    await readFile(
      join(repository, "src", "generated", "managed-website.json"),
      "utf8",
    ),
  ) as { readonly foundationSearch?: { readonly enabled?: unknown } };
  const outputExists = existsSync(join(repository, "public", "pagefind"));
  if (snapshot.foundationSearch?.enabled === true && !outputExists) {
    throw new Error("Enabled Foundation Search build did not produce public/pagefind.");
  }
  if (snapshot.foundationSearch?.enabled !== true && outputExists) {
    throw new Error("Disabled Foundation Search build retained stale public/pagefind output.");
  }
}

async function runPnpm(directory: string, arguments_: readonly string[]) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const executable = packageManagerCli();
    const command =
      executable === undefined
        ? { file: "pnpm", arguments: [...arguments_] }
        : {
            file: process.execPath,
            arguments: [executable, ...arguments_],
          };
    const child = spawn(
      command.file,
      command.arguments,
      {
        cwd: directory,
        env: createIsolatedBuildEnvironment(process.env),
        stdio: process.env.MLGO_DEBUG_VERIFY === "1" ? "inherit" : "ignore",
      },
    );
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else {
        rejectPromise(
          new Error(
            `Client source verification failed during ${String(arguments_[0])}.`,
          ),
        );
      }
    });
  });
}

function packageManagerCli(): string | undefined {
  if (process.env.npm_execpath !== undefined) {
    return process.env.npm_execpath;
  }
  const appData = process.env.APPDATA;
  if (appData === undefined) return undefined;
  const candidate = join(
    appData,
    "npm",
    "node_modules",
    "pnpm",
    "bin",
    "pnpm.cjs",
  );
  return existsSync(candidate) ? candidate : undefined;
}
