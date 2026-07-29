import type { ConfiguredInfrastructure } from "@melbourne-local-growth-ops/contracts";

import type {
  ClientHandoffIssue,
  OptionalDataResourceDeclaration,
  OptionalDataRestorePlanResult,
} from "./handoff-types.js";
import { issue, sortedIssues } from "./handoff-scanner.js";
import { compareText } from "./handoff-integrity.js";

const persistentKinds = new Set([
  "DATABASE",
  "AUTHENTICATION",
  "OBJECT_STORAGE",
]);

function meaningful(value: string): boolean {
  return value.trim().length >= 10 && value.length <= 500;
}

export function createOptionalDataRestorePlan(
  infrastructure: readonly ConfiguredInfrastructure[],
  declarations: readonly OptionalDataResourceDeclaration[],
): OptionalDataRestorePlanResult {
  const required = infrastructure
    .filter(({ kind }) => persistentKinds.has(kind))
    .sort((left, right) =>
      compareText(left.kind, right.kind) ||
      compareText(left.provider, right.provider)
    );
  if (required.length === 0) {
    return Object.freeze({
      success: true,
      data: Object.freeze({
        status: "NOT_APPLICABLE",
        reason:
          "No optional persistent infrastructure is configured",
      }),
    });
  }

  const issues: ClientHandoffIssue[] = [];
  const declarationByKey = new Map(
    declarations.map((declaration) => [
      `${declaration.kind}:${declaration.provider}`,
      declaration,
    ]),
  );
  const resources: OptionalDataResourceDeclaration[] = [];
  for (const configured of required) {
    const path = `optionalDataResources.${configured.kind}`;
    const declaration = declarationByKey.get(
      `${configured.kind}:${configured.provider}`,
    );
    if (
      declaration === undefined ||
      configured.accountOwner !== "CLIENT"
    ) {
      issues.push(issue(
        "MISSING_OPTIONAL_DATA_PLAN",
        path,
        "Client-owned persistent infrastructure requires an explicit backup and restore declaration",
      ));
      continue;
    }
    if (
      declaration.dataOwner !== "CLIENT" ||
      declaration.backupOwner !== "CLIENT" ||
      declaration.restoreOwner !== "CLIENT" ||
      !meaningful(declaration.backupProcedure) ||
      !meaningful(declaration.restoreProcedure) ||
      !meaningful(declaration.verificationProcedure)
    ) {
      issues.push(issue(
        "MISSING_OPTIONAL_DATA_PLAN",
        path,
        "Optional-data ownership and backup, restore, and verification procedures must be explicit",
      ));
      continue;
    }
    resources.push(Object.freeze({ ...declaration }));
  }
  if (issues.length > 0) {
    return Object.freeze({
      success: false,
      issues: sortedIssues(issues),
    });
  }
  return Object.freeze({
    success: true,
    data: Object.freeze({
      status: "REQUIRED",
      resources: Object.freeze(resources),
    }),
  });
}
