import { z } from "zod";

import {
  BusinessIdSchema,
  CapabilitySchema,
  ClientIdSchema,
  CommercialContractReferenceIdSchema,
  EntitlementIdSchema,
  LocationIdSchema,
  SchemaVersionSchema,
} from "./common.js";

export const ClientRecordSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  clientId: ClientIdSchema,
  displayName: z.string().min(1).max(200),
});
export type ClientRecord = z.infer<typeof ClientRecordSchema>;

export const BusinessRecordSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  businessId: BusinessIdSchema,
  clientId: ClientIdSchema,
  legalName: z.string().min(1).max(300),
});
export type BusinessRecord = z.infer<typeof BusinessRecordSchema>;

export const AddressSchema = z.strictObject({
  line1: z.string().min(1).max(200),
  line2: z.string().min(1).max(200).optional(),
  locality: z.string().min(1).max(100),
  region: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
});
export type Address = z.infer<typeof AddressSchema>;

export const LocationRecordSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  locationId: LocationIdSchema,
  businessId: BusinessIdSchema,
  name: z.string().min(1).max(200),
  timezone: z.string().min(1).max(100),
  address: AddressSchema,
});
export type LocationRecord = z.infer<typeof LocationRecordSchema>;

export const EntitlementStatusSchema = z.enum([
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
]);
export type EntitlementStatus = z.infer<typeof EntitlementStatusSchema>;

export const CapabilityEntitlementSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  entitlementId: EntitlementIdSchema,
  clientId: ClientIdSchema,
  capability: CapabilitySchema,
  status: EntitlementStatusSchema,
});
export type CapabilityEntitlement = z.infer<
  typeof CapabilityEntitlementSchema
>;

export const CommercialContractReferenceSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  contractReferenceId: CommercialContractReferenceIdSchema,
  clientId: ClientIdSchema,
  externalSystem: z.string().min(1).max(100),
  externalRecordId: z.string().min(1).max(200),
  entitlementIds: z.array(EntitlementIdSchema).min(1),
});
export type CommercialContractReference = z.infer<
  typeof CommercialContractReferenceSchema
>;
