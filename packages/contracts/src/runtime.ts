import { z } from "zod";

import {
  AccountOwnerSchema,
  ClientIdSchema,
  ConnectorIdSchema,
  DeploymentIdSchema,
  EntitlementIdSchema,
  InfrastructureDependencyListSchema,
  InfrastructureKindSchema,
  LocationIdSchema,
  ModuleIdSchema,
  PortabilitySchema,
  SchemaVersionSchema,
  SecretReferenceIdSchema,
  ServiceConfigurationIdSchema,
  WebsiteConfigurationIdSchema,
} from "./common.js";

const ConnectorBaseShape = {
  schemaVersion: SchemaVersionSchema,
  connectorId: ConnectorIdSchema,
  accountOwner: AccountOwnerSchema,
  portability: PortabilitySchema,
  infrastructureDependencies: InfrastructureDependencyListSchema.optional(),
};

export const EmailDeliveryConnectorSchema = z.strictObject({
  ...ConnectorBaseShape,
  type: z.literal("EMAIL_DELIVERY"),
  provider: z.literal("RESEND"),
  fromAddress: z.email(),
  recipientAddresses: z.array(z.email()).min(1).max(20),
  secretReferenceId: SecretReferenceIdSchema,
});

export const BookingLinkConnectorSchema = z.strictObject({
  ...ConnectorBaseShape,
  type: z.literal("BOOKING_LINK"),
  bookingUrl: z
    .url()
    .refine((value) => value.startsWith("https://"), "URL must use HTTPS"),
});

export const GoogleAnalytics4ConnectorSchema = z.strictObject({
  ...ConnectorBaseShape,
  type: z.literal("GOOGLE_ANALYTICS_4"),
  accountOwner: z.literal("CLIENT"),
  portability: z.literal("CLIENT_OWNED"),
  measurementId: z.string().regex(/^G-[A-Z0-9]{10}$/),
});

export const WebsiteConnectorSchema = z.discriminatedUnion("type", [
  EmailDeliveryConnectorSchema,
  BookingLinkConnectorSchema,
  GoogleAnalytics4ConnectorSchema,
]);
export type WebsiteConnector = z.infer<typeof WebsiteConnectorSchema>;

const ModuleBaseShape = {
  schemaVersion: SchemaVersionSchema,
  moduleId: ModuleIdSchema,
  connectorId: ConnectorIdSchema,
  infrastructureDependencies: InfrastructureDependencyListSchema.optional(),
};

export const LeadFormModuleSchema = z.strictObject({
  ...ModuleBaseShape,
  type: z.literal("LEAD_FORM"),
  fields: z
    .array(z.enum(["NAME", "EMAIL", "PHONE", "MESSAGE"]))
    .min(1)
    .max(4),
});

export const BookingCtaModuleSchema = z.strictObject({
  ...ModuleBaseShape,
  type: z.literal("BOOKING_CTA"),
  label: z.string().min(1).max(100),
});

export const AnalyticsModuleSchema = z.strictObject({
  ...ModuleBaseShape,
  type: z.literal("ANALYTICS"),
});

export const WebsiteModuleSchema = z.discriminatedUnion("type", [
  LeadFormModuleSchema,
  BookingCtaModuleSchema,
  AnalyticsModuleSchema,
]);
export type WebsiteModule = z.infer<typeof WebsiteModuleSchema>;

export const ConfiguredInfrastructureSchema = z.strictObject({
  kind: InfrastructureKindSchema,
  provider: z.string().min(1).max(100),
  accountOwner: AccountOwnerSchema,
});
export type ConfiguredInfrastructure = z.infer<
  typeof ConfiguredInfrastructureSchema
>;

export const DomainConfigurationSchema = z.strictObject({
  hostname: z
    .string()
    .max(253)
    .regex(
      /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    ),
  canonical: z.boolean(),
});
export type DomainConfiguration = z.infer<
  typeof DomainConfigurationSchema
>;

export const WebsiteDisplaySchema = z.strictObject({
  businessName: z.string().min(1).max(200),
  tagline: z.string().min(1).max(300).optional(),
  locationIds: z.array(LocationIdSchema).min(1),
});
export type WebsiteDisplay = z.infer<typeof WebsiteDisplaySchema>;

export const WebsiteRuntimeConfigSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  configurationId: WebsiteConfigurationIdSchema,
  configurationVersion: z.number().int().positive(),
  clientId: ClientIdSchema,
  entitlementId: EntitlementIdSchema,
  deploymentId: DeploymentIdSchema,
  display: WebsiteDisplaySchema,
  domains: z.array(DomainConfigurationSchema).min(1),
  modules: z.array(WebsiteModuleSchema),
  connectors: z.array(WebsiteConnectorSchema),
  configuredInfrastructure: z.array(ConfiguredInfrastructureSchema),
});
export type WebsiteRuntimeConfig = z.infer<
  typeof WebsiteRuntimeConfigSchema
>;

const ServiceConfigurationBaseShape = {
  schemaVersion: SchemaVersionSchema,
  serviceConfigurationId: ServiceConfigurationIdSchema,
  clientId: ClientIdSchema,
  entitlementId: EntitlementIdSchema,
  locationIds: z.array(LocationIdSchema).min(1),
};

export const GooglePresenceConfigurationSchema = z.strictObject({
  ...ServiceConfigurationBaseShape,
  type: z.literal("GOOGLE_PRESENCE"),
});

export const ReputationConfigurationSchema = z.strictObject({
  ...ServiceConfigurationBaseShape,
  type: z.literal("REPUTATION_OPERATIONS"),
});

export const ServiceConfigurationSchema = z.discriminatedUnion("type", [
  GooglePresenceConfigurationSchema,
  ReputationConfigurationSchema,
]);
export type ServiceConfiguration = z.infer<
  typeof ServiceConfigurationSchema
>;
