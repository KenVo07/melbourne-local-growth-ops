import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import contractorInput from "../../../apps/managed-web/client/client-website.json";
import {
  generateClientWebsiteSnapshot,
  parseDefinitionInput,
} from "../../../apps/managed-web/src/generation";
import {
  contractorReferenceExperience,
  foundationSearchOnSelectedSections,
} from "./fixtures";

const publicDirectory = fileURLToPath(
  new URL("../../../apps/managed-web/public", import.meta.url),
);

describe("WEB-01B definition and snapshot handoff", () => {
  it("keeps legacy definitions valid with explicit resolved defaults", () => {
    const snapshot = generateClientWebsiteSnapshot(
      contractorInput,
      publicDirectory,
    );

    expect(snapshot.experience).toMatchObject({
      experienceId: "legacy-contractor",
      source: "LEGACY_PROFILE_DEFAULT",
    });
    expect(snapshot.foundationSearch).toEqual({
      schemaVersion: 1,
      mode: "OFF",
      enabled: false,
      reason: "DEFAULT_OFF",
      records: [],
    });
  });

  it("preserves explicit experience and search through parse and JSON re-read", () => {
    const definition = {
      ...contractorInput,
      experience: contractorReferenceExperience,
      foundationSearch: foundationSearchOnSelectedSections,
    };
    const parsed = parseDefinitionInput(definition);
    const reRead = JSON.parse(JSON.stringify(parsed)) as unknown;
    const snapshot = generateClientWebsiteSnapshot(reRead, publicDirectory);

    expect(parsed.experience).toEqual(contractorReferenceExperience);
    expect(parsed.foundationSearch).toEqual(
      foundationSearchOnSelectedSections,
    );
    expect(snapshot.experience).toMatchObject({
      experienceId: "contractor-reference-split",
      source: "EXPLICIT",
    });
    expect(snapshot.foundationSearch).toMatchObject({
      mode: "ON",
      enabled: true,
      reason: "EXPLICIT_ON",
    });
    expect(snapshot.foundationSearch.records.map(({ url }) => url)).toEqual([
      "/#services",
      "/#trust",
      "/#faq",
      "/#contact",
    ]);
  });

  it("rejects unknown top-level keys instead of silently dropping typos", () => {
    expect(() =>
      parseDefinitionInput({ ...contractorInput, experence: {} }),
    ).toThrow(/unknown top-level field.*experence/i);
  });
});
