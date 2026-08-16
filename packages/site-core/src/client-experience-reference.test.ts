import { describe, expect, it } from "vitest";

import { validateClientExperienceReference } from "./client-experience-reference.js";

describe("ClientExperienceReferenceSchema", () => {
  it("accepts only the fixed non-executable manifest reference", () => {
    const result = validateClientExperienceReference({
      schemaVersion: 1,
      kind: "AUTHORED_CLIENT_EXPERIENCE",
      manifestPath: "experience/manifest.json",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.isFrozen(result.data)).toBe(true);
  });

  it("rejects arbitrary paths and executable fields", () => {
    expect(
      validateClientExperienceReference({
        schemaVersion: 1,
        kind: "AUTHORED_CLIENT_EXPERIENCE",
        manifestPath: "../../private/manifest.json",
      }).success,
    ).toBe(false);
    expect(
      validateClientExperienceReference({
        schemaVersion: 1,
        kind: "AUTHORED_CLIENT_EXPERIENCE",
        manifestPath: "experience/manifest.json",
        source: "export default 1",
      }).success,
    ).toBe(false);
  });
});
