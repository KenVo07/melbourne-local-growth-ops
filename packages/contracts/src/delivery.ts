import { z } from "zod";

import {
  AccountOwnerSchema,
  ClientIdSchema,
  DeploymentIdSchema,
  SchemaVersionSchema,
  SecretReferenceIdSchema,
  WebsiteConfigurationIdSchema,
} from "./common.js";

export const DeliveryModeSchema = z.enum([
  "MANAGED_ISOLATED",
  "CLIENT_HANDOFF",
]);
export type DeliveryMode = z.infer<typeof DeliveryModeSchema>;

export const SecretReferenceSchema = z.strictObject({
  secretReferenceId: SecretReferenceIdSchema,
  owner: AccountOwnerSchema,
});
export type SecretReference = z.infer<typeof SecretReferenceSchema>;

export const PlannedHandoffSchema = z.strictObject({
  status: z.literal("PLANNED"),
  targetOwner: z.literal("CLIENT"),
});

export const InProgressHandoffSchema = z.strictObject({
  status: z.literal("IN_PROGRESS"),
  targetOwner: z.literal("CLIENT"),
});

export const CompletedHandoffSchema = z.strictObject({
  status: z.literal("COMPLETED"),
  targetOwner: z.literal("CLIENT"),
  completedAt: z.iso.datetime(),
});

export const HandoffSchema = z.discriminatedUnion("status", [
  PlannedHandoffSchema,
  InProgressHandoffSchema,
  CompletedHandoffSchema,
]);
export type Handoff = z.infer<typeof HandoffSchema>;

export const DeploymentRecordSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  deploymentId: DeploymentIdSchema,
  clientId: ClientIdSchema,
  websiteConfigurationId: WebsiteConfigurationIdSchema,
  deliveryMode: DeliveryModeSchema,
  operationalOwner: AccountOwnerSchema,
  hostingAccountOwner: AccountOwnerSchema,
  sourceRepositoryOwner: AccountOwnerSchema,
  domainOwner: z.literal("CLIENT"),
  privateAgencyRepositoryDependency: z.boolean(),
  secretReferences: z.array(SecretReferenceSchema),
  handoff: HandoffSchema.optional(),
});
export type DeploymentRecord = z.infer<typeof DeploymentRecordSchema>;
