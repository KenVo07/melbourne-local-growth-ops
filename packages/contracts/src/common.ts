import { z } from "zod";

export const SchemaVersionSchema = z.literal(1);

function identifierSchema<T extends string>(description: string) {
  return z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z][a-z0-9_-]*$/,
      `${description} must use lowercase letters, numbers, underscores, or hyphens`,
    )
    .brand<T>();
}

export const ClientIdSchema = identifierSchema<"ClientId">("Client ID");
export const BusinessIdSchema = identifierSchema<"BusinessId">("Business ID");
export const LocationIdSchema = identifierSchema<"LocationId">("Location ID");
export const EntitlementIdSchema =
  identifierSchema<"EntitlementId">("Entitlement ID");
export const CommercialContractReferenceIdSchema =
  identifierSchema<"CommercialContractReferenceId">(
    "Commercial contract reference ID",
  );
export const WebsiteConfigurationIdSchema =
  identifierSchema<"WebsiteConfigurationId">("Website configuration ID");
export const ServiceConfigurationIdSchema =
  identifierSchema<"ServiceConfigurationId">("Service configuration ID");
export const DeploymentIdSchema =
  identifierSchema<"DeploymentId">("Deployment ID");
export const ModuleIdSchema = identifierSchema<"ModuleId">("Module ID");
export const ConnectorIdSchema =
  identifierSchema<"ConnectorId">("Connector ID");
export const SecretReferenceIdSchema =
  identifierSchema<"SecretReferenceId">("Secret reference ID");

export type ClientId = z.infer<typeof ClientIdSchema>;
export type BusinessId = z.infer<typeof BusinessIdSchema>;
export type LocationId = z.infer<typeof LocationIdSchema>;
export type EntitlementId = z.infer<typeof EntitlementIdSchema>;
export type CommercialContractReferenceId = z.infer<
  typeof CommercialContractReferenceIdSchema
>;
export type WebsiteConfigurationId = z.infer<
  typeof WebsiteConfigurationIdSchema
>;
export type ServiceConfigurationId = z.infer<
  typeof ServiceConfigurationIdSchema
>;
export type DeploymentId = z.infer<typeof DeploymentIdSchema>;
export type ModuleId = z.infer<typeof ModuleIdSchema>;
export type ConnectorId = z.infer<typeof ConnectorIdSchema>;
export type SecretReferenceId = z.infer<typeof SecretReferenceIdSchema>;

export const CapabilitySchema = z.enum([
  "WEBSITE_LEAD_SYSTEMS",
  "GOOGLE_PRESENCE",
  "REPUTATION_OPERATIONS",
]);
export type Capability = z.infer<typeof CapabilitySchema>;

export const AccountOwnerSchema = z.enum(["AGENCY", "CLIENT"]);
export type AccountOwner = z.infer<typeof AccountOwnerSchema>;

export const InfrastructureKindSchema = z.enum([
  "DATABASE",
  "AUTHENTICATION",
  "OBJECT_STORAGE",
  "BACKGROUND_JOBS",
]);
export type InfrastructureKind = z.infer<typeof InfrastructureKindSchema>;

export const InfrastructureDependencyListSchema = z
  .array(InfrastructureKindSchema)
  .max(4);

export const PortabilitySchema = z.enum([
  "AGENCY_MANAGED",
  "TRANSFERABLE",
  "CLIENT_OWNED",
]);
export type Portability = z.infer<typeof PortabilitySchema>;
