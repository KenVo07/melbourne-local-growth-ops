import { describe, expect, it } from "vitest";

import { resolveClientExperienceDependencies } from "../../../apps/managed-web/src/generation/client-experience-dependencies";

function manifest(dependencies: readonly { name: string; version: string }[]) {
  return { publicDependencies: dependencies } as never;
}

describe("resolveClientExperienceDependencies", () => {
  it("projects exact approved dependencies deterministically", () => {
    expect(
      resolveClientExperienceDependencies(
        manifest([
          { name: "motion", version: "12.43.0" },
          { name: "example-runtime", version: "1.2.3" },
        ]),
        [
          {
            name: "example-runtime",
            version: "1.2.3",
            licenceReviewed: true,
            runtimeAllowed: true,
          },
          {
            name: "motion",
            version: "12.43.0",
            licenceReviewed: true,
            runtimeAllowed: true,
          },
        ],
      ),
    ).toEqual({ "example-runtime": "1.2.3", motion: "12.43.0" });
  });

  it("rejects absent and version-drifted approvals", () => {
    expect(() =>
      resolveClientExperienceDependencies(
        manifest([{ name: "motion", version: "12.43.0" }]),
        [],
      ),
    ).toThrow(/no repository approval/);
    expect(() =>
      resolveClientExperienceDependencies(
        manifest([{ name: "motion", version: "12.43.0" }]),
        [
          {
            name: "motion",
            version: "12.42.0",
            licenceReviewed: true,
            runtimeAllowed: true,
          },
        ],
      ),
    ).toThrow(/approval covers/);
  });
});
