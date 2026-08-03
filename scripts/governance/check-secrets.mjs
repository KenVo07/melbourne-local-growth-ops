import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";

const repositoryRoot = process.cwd();
const allowedEnvironmentTemplates = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
]);
const sensitiveExtensions = /\.(?:key|p12|pfx|pem)$/i;
const sensitiveBaseNames = /^(?:id_dsa|id_ecdsa|id_ed25519|id_rsa)$/i;
const secretPatterns = [
  ["private-key header", /-----BEGIN (?:DSA |EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/g],
  ["AWS access-key identifier", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["GitHub token", /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{36,255}\b/g],
  ["GitLab access token", /\bglpat-[0-9A-Za-z_-]{20,}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["npm access token", /\bnpm_[0-9A-Za-z]{36}\b/g],
  ["Resend API key", /\bre_[0-9A-Za-z]{20,}\b/g],
  ["Slack token", /\bxox(?:a|b|p|r|s)-[0-9A-Za-z-]{10,}\b/g],
  ["Stripe live secret", /\bsk_live_[0-9A-Za-z]{16,}\b/g],
];

function fail(message) {
  console.error(`[secret-scan] ${message}`);
  process.exitCode = 1;
}

const listedFiles = spawnSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] },
);

if (listedFiles.error || listedFiles.status !== 0) {
  fail(
    listedFiles.error?.message ??
      listedFiles.stderr.toString("utf8").trim() ??
      "git ls-files failed",
  );
} else {
  const paths = listedFiles.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
  const findings = [];
  let scannedTextFiles = 0;

  for (const relativePath of paths) {
    const fileName = basename(relativePath);
    const lowerFileName = fileName.toLowerCase();
    const isEnvironmentFile =
      lowerFileName === ".env" || lowerFileName.startsWith(".env.");

    if (
      (isEnvironmentFile && !allowedEnvironmentTemplates.has(lowerFileName)) ||
      sensitiveExtensions.test(fileName) ||
      sensitiveBaseNames.test(fileName)
    ) {
      findings.push({ path: relativePath, rule: "sensitive filename" });
      continue;
    }

    const absolutePath = resolve(repositoryRoot, relativePath);
    if (!absolutePath.startsWith(`${repositoryRoot}${sep}`)) {
      findings.push({ path: relativePath, rule: "path escaped repository root" });
      continue;
    }

    const fileStatus = await lstat(absolutePath);
    if (fileStatus.isSymbolicLink()) {
      findings.push({ path: relativePath, rule: "symbolic link requires review" });
      continue;
    }
    if (!fileStatus.isFile()) {
      continue;
    }

    const contents = await readFile(absolutePath);
    if (contents.includes(0)) {
      continue;
    }

    scannedTextFiles += 1;
    const text = contents.toString("utf8");
    for (const [rule, pattern] of secretPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        findings.push({ path: relativePath, rule });
      }
    }
  }

  for (const finding of findings) {
    console.error(`[secret-scan] BLOCKED ${finding.path}: ${finding.rule}`);
  }

  if (findings.length > 0) {
    process.exitCode = 1;
  } else {
    console.log(
      `[secret-scan] PASS scanned ${scannedTextFiles} repository text files (${paths.length} tracked/unignored files considered); file contents are never printed`,
    );
  }
}
