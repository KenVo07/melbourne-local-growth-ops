import { spawnSync } from "node:child_process";

const blockingSeverities = new Set(["critical", "high"]);

const deferrals = new Map([
  [
    "GHSA-6g55-p6wh-862q",
    {
      moduleName: "postcss",
      severity: "high",
      version: "8.4.31",
      paths: new Set([
        ".>next>postcss",
        "apps__managed-web>next>postcss",
        "apps__ops-console>next>postcss",
      ]),
      reviewBy: "2026-08-17",
      reason:
        "Next 16.2.12 pins postcss 8.4.31 exactly and no newer compatible Next release is currently available.",
    },
  ],
  [
    "GHSA-f88m-g3jw-g9cj",
    {
      moduleName: "sharp",
      severity: "high",
      version: "0.34.5",
      paths: new Set([
        ".>next>sharp",
        "apps__managed-web>next>sharp",
        "apps__ops-console>next>sharp",
      ]),
      reviewBy: "2026-08-17",
      reason:
        "Next 16.2.12 constrains sharp to ^0.34.5; the patched 0.35.x line is outside that compatibility range.",
    },
  ],
  [
    "GHSA-r28c-9q8g-f849",
    {
      moduleName: "postcss",
      severity: "high",
      version: "8.4.31",
      paths: new Set([
        ".>next>postcss",
        "apps__managed-web>next>postcss",
        "apps__ops-console>next>postcss",
      ]),
      reviewBy: "2026-08-17",
      reason:
        "Next 16.2.12 pins postcss 8.4.31 exactly and no newer compatible Next release is currently available.",
    },
  ],
]);

function fail(message) {
  console.error(`[dependency-audit] ${message}`);
  process.exitCode = 1;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeAdvisories(report) {
  if (!isRecord(report) || !isRecord(report.advisories)) {
    throw new Error("pnpm audit output did not contain an advisories object");
  }

  return Object.values(report.advisories).map((advisory) => {
    if (
      !isRecord(advisory) ||
      typeof advisory.github_advisory_id !== "string" ||
      typeof advisory.module_name !== "string" ||
      typeof advisory.severity !== "string" ||
      !Array.isArray(advisory.findings)
    ) {
      throw new Error("pnpm audit returned an advisory with an unexpected shape");
    }

    return advisory;
  });
}

function isDeferralValid(advisory, deferral, now) {
  if (!deferral) return false;
  if (advisory.module_name !== deferral.moduleName) return false;
  if (advisory.severity.toLowerCase() !== deferral.severity) return false;

  const reviewDeadline = new Date(`${deferral.reviewBy}T23:59:59.999Z`);
  if (Number.isNaN(reviewDeadline.valueOf()) || now > reviewDeadline) return false;

  if (advisory.findings.length === 0) return false;

  const actualPaths = new Set();
  for (const finding of advisory.findings) {
    if (!isRecord(finding)) return false;
    if (typeof finding.version !== "string" || finding.version !== deferral.version) return false;
    if (!Array.isArray(finding.paths) || finding.paths.length === 0) return false;
    for (const p of finding.paths) {
      if (typeof p !== "string") return false;
      actualPaths.add(p);
    }
  }

  if (actualPaths.size !== deferral.paths.size) return false;
  for (const p of actualPaths) {
    if (!deferral.paths.has(p)) return false;
  }

  return true;
}

function evaluateReport(report, now = new Date()) {
  const blocked = [];
  const deferred = [];

  for (const advisory of normalizeAdvisories(report)) {
    if (!blockingSeverities.has(advisory.severity.toLowerCase())) {
      continue;
    }

    const deferral = deferrals.get(advisory.github_advisory_id);
    const findingPaths = advisory.findings.flatMap((finding) =>
      isRecord(finding) && Array.isArray(finding.paths) ? finding.paths : [],
    );

    if (!isDeferralValid(advisory, deferral, now)) {
      blocked.push({
        id: advisory.github_advisory_id,
        moduleName: advisory.module_name,
        severity: advisory.severity,
        paths: findingPaths,
      });
      continue;
    }

    deferred.push({
      id: advisory.github_advisory_id,
      moduleName: advisory.module_name,
      reviewBy: deferral.reviewBy,
      reason: deferral.reason,
    });
  }

  return { blocked, deferred };
}

function runSelfTest() {
  const finding = (id, severity, moduleName, version, paths) => ({
    github_advisory_id: id,
    severity,
    module_name: moduleName,
    findings: [{ version, paths }],
  });
  const reports = [
    {
      label: "moderate advisories do not cross the high threshold",
      report: {
        advisories: {
          moderate: finding("GHSA-example-moderate", "moderate", "example", "1.0.0", [
            ".>example",
          ]),
        },
      },
      expectedBlocked: 0,
      expectedDeferred: 0,
    },
    {
      label: "an unknown high advisory blocks",
      report: {
        advisories: {
          high: finding("GHSA-example-high", "high", "example", "1.0.0", [
            ".>example",
          ]),
        },
      },
      expectedBlocked: 1,
      expectedDeferred: 0,
    },
    {
      label: "the exact time-bounded sharp advisory is deferred",
      report: {
        advisories: {
          sharp: finding("GHSA-f88m-g3jw-g9cj", "high", "sharp", "0.34.5", [
            ".>next>sharp",
            "apps__managed-web>next>sharp",
            "apps__ops-console>next>sharp",
          ]),
        },
      },
      expectedBlocked: 0,
      expectedDeferred: 1,
    },
    {
      label: "an expired deferral blocks",
      report: {
        advisories: {
          sharp: finding("GHSA-f88m-g3jw-g9cj", "high", "sharp", "0.34.5", [
            ".>next>sharp",
            "apps__managed-web>next>sharp",
            "apps__ops-console>next>sharp",
          ]),
        },
      },
      now: new Date("2026-08-18T00:00:00Z"),
      expectedBlocked: 1,
      expectedDeferred: 0,
    },
    {
      label: "empty findings array blocks",
      report: {
        advisories: {
          sharp: {
            github_advisory_id: "GHSA-f88m-g3jw-g9cj",
            severity: "high",
            module_name: "sharp",
            findings: [],
          },
        },
      },
      expectedBlocked: 1,
      expectedDeferred: 0,
    },
    {
      label: "subset path drift blocks",
      report: {
        advisories: {
          sharp: finding("GHSA-f88m-g3jw-g9cj", "high", "sharp", "0.34.5", [
            ".>next>sharp",
          ]),
        },
      },
      expectedBlocked: 1,
      expectedDeferred: 0,
    },
    {
      label: "superset path drift blocks",
      report: {
        advisories: {
          sharp: finding("GHSA-f88m-g3jw-g9cj", "high", "sharp", "0.34.5", [
            ".>next>sharp",
            "apps__managed-web>next>sharp",
            "apps__ops-console>next>sharp",
            "apps__extra>next>sharp",
          ]),
        },
      },
      expectedBlocked: 1,
      expectedDeferred: 0,
    },
    {
      label: "version drift blocks",
      report: {
        advisories: {
          sharp: finding("GHSA-f88m-g3jw-g9cj", "high", "sharp", "0.34.6", [
            ".>next>sharp",
            "apps__managed-web>next>sharp",
            "apps__ops-console>next>sharp",
          ]),
        },
      },
      expectedBlocked: 1,
      expectedDeferred: 0,
    },
    {
      label: "module drift blocks",
      report: {
        advisories: {
          sharp: finding("GHSA-f88m-g3jw-g9cj", "high", "sharp-other", "0.34.5", [
            ".>next>sharp",
            "apps__managed-web>next>sharp",
            "apps__ops-console>next>sharp",
          ]),
        },
      },
      expectedBlocked: 1,
      expectedDeferred: 0,
    },
    {
      label: "critical severity escalation blocks",
      report: {
        advisories: {
          sharp: finding("GHSA-f88m-g3jw-g9cj", "critical", "sharp", "0.34.5", [
            ".>next>sharp",
            "apps__managed-web>next>sharp",
            "apps__ops-console>next>sharp",
          ]),
        },
      },
      expectedBlocked: 1,
      expectedDeferred: 0,
    },
  ];

  for (const testCase of reports) {
    const result = evaluateReport(
      testCase.report,
      testCase.now ?? new Date("2026-08-03T00:00:00Z"),
    );
    if (
      result.blocked.length !== testCase.expectedBlocked ||
      result.deferred.length !== testCase.expectedDeferred
    ) {
      throw new Error(`self-test failed: ${testCase.label}`);
    }
    console.log(`[dependency-audit:self-test] PASS ${testCase.label}`);
  }
}

if (process.argv.includes("--self-test")) {
  try {
    runSelfTest();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
} else {
  const pnpmExecutable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const audit = spawnSync(
    pnpmExecutable,
    ["audit", "--audit-level", "high", "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );

  if (audit.error) {
    fail(`could not run pnpm audit: ${audit.error.message}`);
  } else {
    try {
      const report = JSON.parse(audit.stdout);
      const result = evaluateReport(report);

      for (const advisory of result.deferred) {
        console.warn(
          `[dependency-audit] DEFERRED ${advisory.id} (${advisory.moduleName}) through ${advisory.reviewBy}: ${advisory.reason}`,
        );
      }

      for (const advisory of result.blocked) {
        console.error(
          `[dependency-audit] BLOCKED ${advisory.id} (${advisory.moduleName}, ${advisory.severity}); paths: ${advisory.paths.join(", ") || "unreported"}`,
        );
      }

      if (result.blocked.length > 0) {
        process.exitCode = 1;
      } else {
        console.log(
          `[dependency-audit] PASS no undeferred high or critical advisories; ${result.deferred.length} explicit deferral(s) remain`,
        );
      }
    } catch (error) {
      const diagnostic = audit.stderr.trim();
      fail(
        `${error instanceof Error ? error.message : String(error)}${diagnostic ? `; pnpm: ${diagnostic}` : ""}`,
      );
    }
  }
}
