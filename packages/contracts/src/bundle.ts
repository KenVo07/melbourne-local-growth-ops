import { z } from "zod";

import type { Capability, InfrastructureKind } from "./common.js";
import {
  BusinessRecordSchema,
  CapabilityEntitlementSchema,
  ClientRecordSchema,
  CommercialContractReferenceSchema,
  LocationRecordSchema,
} from "./commercial.js";
import { DeploymentRecordSchema } from "./delivery.js";
import type { DeploymentRecord } from "./delivery.js";
import {
  ServiceConfigurationSchema,
  WebsiteRuntimeConfigSchema,
} from "./runtime.js";
import type {
  ServiceConfiguration,
  WebsiteConnector,
  WebsiteRuntimeConfig,
} from "./runtime.js";
import {
  issue,
  translateZodIssues,
  validationFailure,
} from "./validation.js";
import type {
  ValidationIssue,
  ValidationResult,
} from "./validation.js";

export const ContractBundleSchema = z.strictObject({
  schemaVersion: z.literal(1),
  clients: z.array(ClientRecordSchema),
  businesses: z.array(BusinessRecordSchema),
  locations: z.array(LocationRecordSchema),
  entitlements: z.array(CapabilityEntitlementSchema),
  commercialContractReferences: z.array(CommercialContractReferenceSchema),
  websiteConfigurations: z.array(WebsiteRuntimeConfigSchema),
  serviceConfigurations: z.array(ServiceConfigurationSchema),
  deployments: z.array(DeploymentRecordSchema),
});
export type ContractBundle = z.infer<typeof ContractBundleSchema>;

type Path = readonly (string | number)[];

function duplicateIssues<T>(
  values: readonly T[],
  keyOf: (value: T) => string,
  path: Path,
): ValidationIssue[] {
  const seen = new Set<string>();
  const issues: ValidationIssue[] = [];

  values.forEach((value, index) => {
    const key = keyOf(value);
    if (seen.has(key)) {
      issues.push(
        issue(
          "DUPLICATE_IDENTIFIER",
          [...path, index],
          `Identifier must be unique: ${key}`,
        ),
      );
    }
    seen.add(key);
  });

  return issues;
}

function expectedConnectorType(
  moduleType: WebsiteRuntimeConfig["modules"][number]["type"],
): WebsiteConnector["type"] {
  switch (moduleType) {
    case "LEAD_FORM":
      return "EMAIL_DELIVERY";
    case "BOOKING_CTA":
      return "BOOKING_LINK";
    case "ANALYTICS":
      return "GOOGLE_ANALYTICS_4";
  }
}

function websiteSemanticIssues(
  config: WebsiteRuntimeConfig,
  path: Path = [],
): ValidationIssue[] {
  const issues = [
    ...duplicateIssues(
      config.modules,
      (module) => module.moduleId,
      [...path, "modules"],
    ),
    ...duplicateIssues(
      config.connectors,
      (connector) => connector.connectorId,
      [...path, "connectors"],
    ),
    ...duplicateIssues(
      config.configuredInfrastructure,
      (infrastructure) => infrastructure.kind,
      [...path, "configuredInfrastructure"],
    ),
  ];

  const connectors = new Map(
    config.connectors.map((connector) => [
      connector.connectorId,
      connector,
    ]),
  );

  config.modules.forEach((module, index) => {
    const connector = connectors.get(module.connectorId);
    if (!connector) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          [...path, "modules", index, "connectorId"],
          `Connector does not exist: ${module.connectorId}`,
        ),
      );
      return;
    }

    const expected = expectedConnectorType(module.type);
    if (connector.type !== expected) {
      issues.push(
        issue(
          "CONNECTOR_TYPE_MISMATCH",
          [...path, "modules", index, "connectorId"],
          `${module.type} requires ${expected}, received ${connector.type}`,
        ),
      );
    }
  });

  const resolved = new Set<InfrastructureKind>();
  for (const module of config.modules) {
    for (const dependency of module.infrastructureDependencies ?? []) {
      resolved.add(dependency);
    }
  }
  for (const connector of config.connectors) {
    for (const dependency of connector.infrastructureDependencies ?? []) {
      resolved.add(dependency);
    }
  }

  const configured = new Set(
    config.configuredInfrastructure.map(({ kind }) => kind),
  );
  const missing = [...resolved].filter((kind) => !configured.has(kind));
  const surplus = [...configured].filter((kind) => !resolved.has(kind));
  if (missing.length > 0 || surplus.length > 0) {
    const details = [
      missing.length > 0 ? `missing ${missing.join(", ")}` : undefined,
      surplus.length > 0 ? `surplus ${surplus.join(", ")}` : undefined,
    ]
      .filter((detail) => detail !== undefined)
      .join("; ");
    issues.push(
      issue(
        "INFRASTRUCTURE_DEPENDENCY_MISMATCH",
        [...path, "configuredInfrastructure"],
        `Configured infrastructure must equal resolved dependencies: ${details}`,
      ),
    );
  }

  return issues;
}

function handoffIssues(
  deployment: DeploymentRecord,
  website: WebsiteRuntimeConfig | undefined,
  path: Path,
  websitePath: Path | undefined,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const status = deployment.handoff?.status;
  const completed = status === "COMPLETED";
  const preCompletion = status === undefined
    || status === "PLANNED"
    || status === "IN_PROGRESS";

  if (
    (preCompletion && deployment.deliveryMode !== "MANAGED_ISOLATED")
    || (completed && deployment.deliveryMode !== "CLIENT_HANDOFF")
  ) {
    issues.push(
      issue(
        "DELIVERY_HANDOFF_MISMATCH",
        [...path, "deliveryMode"],
        completed
          ? "Completed handoff requires CLIENT_HANDOFF delivery"
          : "Delivery remains MANAGED_ISOLATED until handoff is completed",
      ),
    );
  }

  const expectedOwner = completed ? "CLIENT" : "AGENCY";
  for (const field of [
    "operationalOwner",
    "hostingAccountOwner",
    "sourceRepositoryOwner",
  ] as const) {
    if (deployment[field] !== expectedOwner) {
      issues.push(
        issue(
          "OWNERSHIP_MISMATCH",
          [...path, field],
          `${field} must be ${expectedOwner} for the current handoff state`,
        ),
      );
    }
  }

  if (!completed) {
    return issues;
  }

  if (deployment.privateAgencyRepositoryDependency) {
    issues.push(
      issue(
        "HANDOFF_PORTABILITY_VIOLATION",
        [...path, "privateAgencyRepositoryDependency"],
        "Completed handoff cannot depend on a private agency repository",
      ),
    );
  }

  deployment.secretReferences.forEach((reference, index) => {
    if (reference.owner === "AGENCY") {
      issues.push(
        issue(
          "AGENCY_SECRET_DEPENDENCY",
          [...path, "secretReferences", index, "owner"],
          "Completed handoff cannot depend on an agency-owned secret",
        ),
      );
    }
  });

  website?.connectors.forEach((connector, index) => {
    if (
      connector.accountOwner !== "CLIENT"
      || connector.portability === "AGENCY_MANAGED"
    ) {
      issues.push(
        issue(
          "HANDOFF_PORTABILITY_VIOLATION",
          [
            ...(websitePath ?? ["websiteConfigurations"]),
            "connectors",
            index,
          ],
          "Completed handoff connectors must be client-owned and portable",
        ),
      );
    }
  });

  website?.configuredInfrastructure.forEach((infrastructure, index) => {
    if (infrastructure.accountOwner !== "CLIENT") {
      issues.push(
        issue(
          "OWNERSHIP_MISMATCH",
          [
            ...(websitePath ?? ["websiteConfigurations"]),
            "configuredInfrastructure",
            index,
            "accountOwner",
          ],
          "Completed handoff infrastructure must be client-owned",
        ),
      );
    }
  });

  return issues;
}

function expectedServiceCapability(
  service: ServiceConfiguration,
): Capability {
  return service.type === "GOOGLE_PRESENCE"
    ? "GOOGLE_PRESENCE"
    : "REPUTATION_OPERATIONS";
}

function bundleSemanticIssues(bundle: ContractBundle): ValidationIssue[] {
  const issues: ValidationIssue[] = [
    ...duplicateIssues(bundle.clients, (value) => value.clientId, ["clients"]),
    ...duplicateIssues(
      bundle.businesses,
      (value) => value.businessId,
      ["businesses"],
    ),
    ...duplicateIssues(
      bundle.locations,
      (value) => value.locationId,
      ["locations"],
    ),
    ...duplicateIssues(
      bundle.entitlements,
      (value) => value.entitlementId,
      ["entitlements"],
    ),
    ...duplicateIssues(
      bundle.commercialContractReferences,
      (value) => value.contractReferenceId,
      ["commercialContractReferences"],
    ),
    ...duplicateIssues(
      bundle.websiteConfigurations,
      (value) => value.configurationId,
      ["websiteConfigurations"],
    ),
    ...duplicateIssues(
      bundle.serviceConfigurations,
      (value) => value.serviceConfigurationId,
      ["serviceConfigurations"],
    ),
    ...duplicateIssues(
      bundle.deployments,
      (value) => value.deploymentId,
      ["deployments"],
    ),
  ];

  const clients = new Map(
    bundle.clients.map((client) => [client.clientId, client]),
  );
  const businesses = new Map(
    bundle.businesses.map((business) => [business.businessId, business]),
  );
  const locations = new Map(
    bundle.locations.map((location) => [location.locationId, location]),
  );
  const entitlements = new Map(
    bundle.entitlements.map((entitlement) => [
      entitlement.entitlementId,
      entitlement,
    ]),
  );
  const websites = new Map(
    bundle.websiteConfigurations.map((website) => [
      website.configurationId,
      website,
    ]),
  );
  const deployments = new Map(
    bundle.deployments.map((deployment) => [
      deployment.deploymentId,
      deployment,
    ]),
  );

  bundle.businesses.forEach((business, index) => {
    if (!clients.has(business.clientId)) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          ["businesses", index, "clientId"],
          `Client does not exist: ${business.clientId}`,
        ),
      );
    }
  });

  bundle.locations.forEach((location, index) => {
    if (!businesses.has(location.businessId)) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          ["locations", index, "businessId"],
          `Business does not exist: ${location.businessId}`,
        ),
      );
    }
  });

  bundle.entitlements.forEach((entitlement, index) => {
    if (!clients.has(entitlement.clientId)) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          ["entitlements", index, "clientId"],
          `Client does not exist: ${entitlement.clientId}`,
        ),
      );
    }
  });

  bundle.commercialContractReferences.forEach((reference, index) => {
    if (!clients.has(reference.clientId)) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          ["commercialContractReferences", index, "clientId"],
          `Client does not exist: ${reference.clientId}`,
        ),
      );
    }
    reference.entitlementIds.forEach((entitlementId, entitlementIndex) => {
      const entitlement = entitlements.get(entitlementId);
      if (!entitlement || entitlement.clientId !== reference.clientId) {
        issues.push(
          issue(
            "REFERENCE_NOT_FOUND",
            [
              "commercialContractReferences",
              index,
              "entitlementIds",
              entitlementIndex,
            ],
            "Commercial reference entitlement must belong to the same client",
          ),
        );
      }
    });
  });

  bundle.websiteConfigurations.forEach((website, index) => {
    issues.push(
      ...websiteSemanticIssues(website, ["websiteConfigurations", index]),
    );

    if (!clients.has(website.clientId)) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          ["websiteConfigurations", index, "clientId"],
          `Client does not exist: ${website.clientId}`,
        ),
      );
    }

    const entitlement = entitlements.get(website.entitlementId);
    if (
      !entitlement
      || entitlement.clientId !== website.clientId
      || entitlement.capability !== "WEBSITE_LEAD_SYSTEMS"
    ) {
      issues.push(
        issue(
          "CAPABILITY_ENTITLEMENT_MISSING",
          ["websiteConfigurations", index, "entitlementId"],
          "Website configuration requires a same-client Website & Lead Systems entitlement",
        ),
      );
    }

    const deployment = deployments.get(website.deploymentId);
    if (
      !deployment
      || deployment.clientId !== website.clientId
      || deployment.websiteConfigurationId !== website.configurationId
    ) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          ["websiteConfigurations", index, "deploymentId"],
          "Website deployment must exist and belong to the same client and configuration",
        ),
      );
    }

    website.display.locationIds.forEach((locationId, locationIndex) => {
      const location = locations.get(locationId);
      const business = location
        ? businesses.get(location.businessId)
        : undefined;
      if (!business || business.clientId !== website.clientId) {
        issues.push(
          issue(
            "REFERENCE_NOT_FOUND",
            [
              "websiteConfigurations",
              index,
              "display",
              "locationIds",
              locationIndex,
            ],
            "Website location must belong to the same client",
          ),
        );
      }
    });
  });

  bundle.serviceConfigurations.forEach((service, index) => {
    const entitlement = entitlements.get(service.entitlementId);
    if (!entitlement || entitlement.clientId !== service.clientId) {
      issues.push(
        issue(
          "CAPABILITY_ENTITLEMENT_MISSING",
          ["serviceConfigurations", index, "entitlementId"],
          "Service configuration requires a same-client entitlement",
        ),
      );
    } else if (
      entitlement.capability !== expectedServiceCapability(service)
    ) {
      issues.push(
        issue(
          "SERVICE_CAPABILITY_MISMATCH",
          ["serviceConfigurations", index, "entitlementId"],
          `Entitlement capability must match ${service.type}`,
        ),
      );
    }

    service.locationIds.forEach((locationId, locationIndex) => {
      const location = locations.get(locationId);
      const business = location
        ? businesses.get(location.businessId)
        : undefined;
      if (!business || business.clientId !== service.clientId) {
        issues.push(
          issue(
            "REFERENCE_NOT_FOUND",
            [
              "serviceConfigurations",
              index,
              "locationIds",
              locationIndex,
            ],
            "Service location must belong to the same client",
          ),
        );
      }
    });
  });

  bundle.deployments.forEach((deployment, index) => {
    const website = websites.get(deployment.websiteConfigurationId);
    const websiteIndex = website
      ? bundle.websiteConfigurations.indexOf(website)
      : undefined;
    const websitePath = websiteIndex === undefined
      ? undefined
      : ["websiteConfigurations", websiteIndex] as const;
    if (
      !website
      || website.clientId !== deployment.clientId
      || website.deploymentId !== deployment.deploymentId
    ) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          ["deployments", index, "websiteConfigurationId"],
          "Deployment website must exist and belong to the same client and deployment",
        ),
      );
    }
    issues.push(
      ...duplicateIssues(
        deployment.secretReferences,
        (reference) => reference.secretReferenceId,
        ["deployments", index, "secretReferences"],
      ),
    );
    website?.connectors.forEach((connector, connectorIndex) => {
      if (
        connector.type === "EMAIL_DELIVERY"
        && !deployment.secretReferences.some(
          (reference) =>
            reference.secretReferenceId === connector.secretReferenceId,
        )
      ) {
        issues.push(
          issue(
            "REFERENCE_NOT_FOUND",
            [
              ...(websitePath ?? ["websiteConfigurations"]),
              "connectors",
              connectorIndex,
              "secretReferenceId",
            ],
            "Email connector secret reference must exist in its deployment record",
          ),
        );
      }
    });
    issues.push(
      ...handoffIssues(
        deployment,
        website,
        ["deployments", index],
        websitePath,
      ),
    );
  });

  return issues;
}

export function validateWebsiteRuntimeConfig(
  input: unknown,
): ValidationResult<WebsiteRuntimeConfig> {
  const result = WebsiteRuntimeConfigSchema.safeParse(input);
  if (!result.success) {
    return validationFailure(translateZodIssues(result.error.issues));
  }

  const issues = websiteSemanticIssues(result.data);
  return issues.length > 0
    ? validationFailure(issues)
    : { success: true, data: result.data };
}

export function validateContractBundle(
  input: unknown,
): ValidationResult<ContractBundle> {
  const result = ContractBundleSchema.safeParse(input);
  if (!result.success) {
    return validationFailure(translateZodIssues(result.error.issues));
  }

  const issues = bundleSemanticIssues(result.data);
  return issues.length > 0
    ? validationFailure(issues)
    : { success: true, data: result.data };
}
