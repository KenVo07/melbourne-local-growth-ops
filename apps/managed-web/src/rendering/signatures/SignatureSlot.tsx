import type {
  RuntimeWebsiteExperience,
  RuntimeWebsiteProfileContent,
} from "../../runtime-types";
import { ServiceAreaProof } from "./ServiceAreaProof";

export interface SignatureSlotProps {
  readonly businessName: string;
  readonly placement: NonNullable<
    RuntimeWebsiteExperience["signature"]
  >["placement"];
  readonly profile: RuntimeWebsiteProfileContent;
  readonly signature: RuntimeWebsiteExperience["signature"];
}

export function SignatureSlot({
  businessName,
  placement,
  profile,
  signature,
}: SignatureSlotProps) {
  if (signature === undefined || signature.placement !== placement) return null;

  if (
    signature.signatureId !== "service-area-proof" ||
    signature.signatureVersion !== "1.0.0"
  ) {
    throw new TypeError(
      `Unsupported website signature ${signature.signatureId}@${signature.signatureVersion}.`,
    );
  }

  return <ServiceAreaProof businessName={businessName} profile={profile} />;
}
