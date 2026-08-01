import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import {
  verifyClientHandoffDirectory,
} from "../../packages/deployment/dist/index.js";

import {
  handoffCommandFailure,
  runHandoffCommand,
} from "./command-output.mjs";

const CHECKS = Object.freeze([
  Object.freeze({
    step: "install",
    arguments: ["install", "--frozen-lockfile", "--ignore-scripts"],
  }),
  Object.freeze({ step: "typecheck", arguments: ["typecheck"] }),
  Object.freeze({ step: "build", arguments: ["build"] }),
  Object.freeze({ step: "test", arguments: ["test"] }),
  Object.freeze({ step: "integrity", arguments: ["verify:handoff"] }),
]);

function cleanEnvironment(temporaryRoot) {
  const safeKeys = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "ComSpec",
    "WINDIR",
  ];
  const environment = {};
  for (const key of safeKeys) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return {
    ...environment,
    CI: "true",
    NO_COLOR: "1",
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    NPM_CONFIG_USERCONFIG: join(temporaryRoot, "empty-user-npmrc"),
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
  };
}

function spawnPackageManager({ cwd, arguments: commandArguments, environment }) {
  return new Promise((resolve) => {
    const windows = process.platform === "win32";
    const executable = windows
      ? (environment.ComSpec ?? environment.COMSPEC ?? "cmd.exe")
      : "pnpm";
    const executableArguments = windows
      ? ["/d", "/s", "/c", "pnpm.cmd", ...commandArguments]
      : commandArguments;
    let child;
    try {
      child = spawn(executable, executableArguments, {
        cwd,
        env: environment,
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      resolve(false);
      return;
    }
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

/**
 * Copies a verified transfer into a fresh temporary directory, strips ambient
 * credential-bearing environment variables, and runs the delivered repository
 * gates. No command output or environment value is emitted.
 */
export async function verifyHandoffOnCleanMachine({
  sourceDirectory,
  offline = false,
  run = spawnPackageManager,
}) {
  const transfer = await verifyClientHandoffDirectory(sourceDirectory);
  if (!transfer.success) return transfer;

  const temporaryRoot = await mkdtemp(join(tmpdir(), "mlgo-clean-handoff-"));
  const cleanRepository = join(temporaryRoot, "repository");
  let stage = "prepare";
  try {
    await writeFile(join(temporaryRoot, "empty-user-npmrc"), "");
    stage = "copy";
    await cp(sourceDirectory, cleanRepository, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    stage = "commands";
    const environment = cleanEnvironment(temporaryRoot);
    const completed = [];
    for (const check of CHECKS) {
      const commandArguments = [...check.arguments];
      if (check.step === "install" && offline) commandArguments.push("--offline");
      const passed = await run({
        cwd: cleanRepository,
        arguments: commandArguments,
        environment,
      });
      if (!passed) {
        return handoffCommandFailure(
          "CLEAN_MACHINE_VERIFICATION_FAILED",
          `Clean handoff verification failed at ${check.step}`,
        );
      }
      completed.push(check.step);
    }
    return Object.freeze({
      success: true,
      checks: Object.freeze(completed),
      sourceClientId: transfer.manifest.clientId,
      sourceDeploymentId: transfer.manifest.deploymentId,
      ambientSecretsForwarded: false,
    });
  } catch {
    return handoffCommandFailure(
      "CLEAN_MACHINE_VERIFICATION_FAILED",
      `Clean handoff verification could not be completed at ${stage}`,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() =>
      undefined
    );
  }
}

export async function verifyClientRepositoryCommand(options) {
  return runHandoffCommand(
    () => verifyHandoffOnCleanMachine(options),
    options.write,
  );
}
