import type { z } from "zod";

export type ValidationIssueCode =
  | "INVALID_INPUT"
  | "INVALID_TYPE"
  | "INVALID_LITERAL"
  | "INVALID_FORMAT"
  | "INVALID_LENGTH"
  | "UNKNOWN_FIELD"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "DUPLICATE_IDENTIFIER"
  | "REFERENCE_NOT_FOUND"
  | "CAPABILITY_ENTITLEMENT_MISSING"
  | "SERVICE_CAPABILITY_MISMATCH"
  | "DELIVERY_HANDOFF_MISMATCH"
  | "OWNERSHIP_MISMATCH"
  | "CONNECTOR_TYPE_MISMATCH"
  | "INFRASTRUCTURE_DEPENDENCY_MISMATCH"
  | "HANDOFF_PORTABILITY_VIOLATION"
  | "AGENCY_SECRET_DEPENDENCY";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] };

export function issue(
  code: ValidationIssueCode,
  path: readonly PropertyKey[],
  message: string,
): ValidationIssue {
  return Object.freeze({
    code,
    path: Object.freeze(
      path.map((segment) =>
        typeof segment === "symbol" ? String(segment) : segment
      ),
    ),
    message,
  });
}

function translatedCode(
  zodIssue: z.core.$ZodIssue,
): ValidationIssueCode {
  if (zodIssue.path.at(-1) === "schemaVersion") {
    return "UNSUPPORTED_SCHEMA_VERSION";
  }

  switch (zodIssue.code) {
    case "invalid_type":
      return "INVALID_TYPE";
    case "invalid_value":
    case "invalid_union":
      return "INVALID_LITERAL";
    case "invalid_format":
      return "INVALID_FORMAT";
    case "too_big":
    case "too_small":
      return "INVALID_LENGTH";
    case "unrecognized_keys":
      return "UNKNOWN_FIELD";
    default:
      return "INVALID_INPUT";
  }
}

export function translateZodIssues(
  zodIssues: readonly z.core.$ZodIssue[],
): readonly ValidationIssue[] {
  return Object.freeze(
    zodIssues.flatMap((zodIssue) => {
      if (zodIssue.code === "unrecognized_keys") {
        return zodIssue.keys.map((key) =>
          issue(
            "UNKNOWN_FIELD",
            [...zodIssue.path, key],
            `Unknown field: ${String(key)}`,
          ),
        );
      }

      return [
        issue(
          translatedCode(zodIssue),
          zodIssue.path,
          zodIssue.message,
        ),
      ];
    }),
  );
}

export function validationFailure(
  issues: readonly ValidationIssue[],
): ValidationResult<never> {
  return { success: false, issues: Object.freeze([...issues]) };
}
