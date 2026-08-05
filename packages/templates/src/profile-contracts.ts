import type {
  WebsiteArchetype,
  WebsiteProfile,
  WebsiteProfileContent,
  WebsiteTemplateReference,
} from "@melbourne-local-growth-ops/site-core";

export interface WebsiteProfileTemplateContract {
  readonly profile: WebsiteProfile;
  readonly archetype: WebsiteArchetype;
  readonly template: WebsiteTemplateReference;
}

export type WebsiteProfileContractErrorCode =
  | "UNKNOWN_PROFILE_CONTRACT"
  | "PROFILE_ARCHETYPE_MISMATCH"
  | "PROFILE_TEMPLATE_MISMATCH";

export class WebsiteProfileContractError extends Error {
  override readonly name = "WebsiteProfileContractError";
  readonly code: WebsiteProfileContractErrorCode;
  readonly profile: WebsiteProfile;
  readonly expected: WebsiteProfileTemplateContract | undefined;
  readonly actualArchetype: WebsiteArchetype;
  readonly actualTemplate: WebsiteTemplateReference;

  constructor(
    code: WebsiteProfileContractErrorCode,
    profile: WebsiteProfileContent,
    template: WebsiteTemplateReference,
    expected?: WebsiteProfileTemplateContract,
  ) {
    super(contractErrorMessage(code, profile, template, expected));
    this.code = code;
    this.profile = profile.profile;
    this.expected = expected;
    this.actualArchetype = profile.archetype;
    this.actualTemplate = Object.freeze({ ...template });
  }
}

export const websiteProfileTemplateContracts: readonly WebsiteProfileTemplateContract[] =
  Object.freeze([
    contract("CONTRACTOR", "SERVICE_LED", "contractor"),
    contract("RESTAURANT", "HOSPITALITY_EDITORIAL", "restaurant"),
    contract("RETAILER", "CATALOGUE_LED", "retailer"),
  ]);

const contractsByProfile = new Map(
  websiteProfileTemplateContracts.map((profileContract) => [
    profileContract.profile,
    profileContract,
  ]),
);

export function getWebsiteProfileTemplateContract(
  profile: WebsiteProfile,
): WebsiteProfileTemplateContract | undefined {
  return contractsByProfile.get(profile);
}

export function assertWebsiteProfileTemplateConsistency(
  profile: WebsiteProfileContent,
  template: WebsiteTemplateReference,
): WebsiteProfileTemplateContract {
  const expected = getWebsiteProfileTemplateContract(profile.profile);
  if (expected === undefined) {
    throw new WebsiteProfileContractError(
      "UNKNOWN_PROFILE_CONTRACT",
      profile,
      template,
    );
  }
  if (profile.archetype !== expected.archetype) {
    throw new WebsiteProfileContractError(
      "PROFILE_ARCHETYPE_MISMATCH",
      profile,
      template,
      expected,
    );
  }
  if (
    template.templateId !== expected.template.templateId ||
    template.templateVersion !== expected.template.templateVersion
  ) {
    throw new WebsiteProfileContractError(
      "PROFILE_TEMPLATE_MISMATCH",
      profile,
      template,
      expected,
    );
  }
  return expected;
}

function contract(
  profile: WebsiteProfile,
  archetype: WebsiteArchetype,
  templateId: string,
): WebsiteProfileTemplateContract {
  return Object.freeze({
    profile,
    archetype,
    template: Object.freeze({ templateId, templateVersion: "1.0.0" }),
  });
}

function contractErrorMessage(
  code: WebsiteProfileContractErrorCode,
  profile: WebsiteProfileContent,
  template: WebsiteTemplateReference,
  expected?: WebsiteProfileTemplateContract,
): string {
  switch (code) {
    case "UNKNOWN_PROFILE_CONTRACT":
      return `Profile "${profile.profile}" has no registered template contract.`;
    case "PROFILE_ARCHETYPE_MISMATCH":
      return `Profile "${profile.profile}" requires archetype "${String(expected?.archetype)}", not "${profile.archetype}".`;
    case "PROFILE_TEMPLATE_MISMATCH":
      return `Profile "${profile.profile}" requires template "${String(expected?.template.templateId)}" version "${String(expected?.template.templateVersion)}", not "${template.templateId}" version "${template.templateVersion}".`;
  }
}
