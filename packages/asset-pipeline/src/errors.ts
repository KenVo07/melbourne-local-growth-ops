export type AssetPipelineErrorCode =
  | "INVALID_ASSET_MANIFEST"
  | "INVALID_CLIENT_ID"
  | "INVALID_PUBLIC_DIRECTORY"
  | "INVALID_ASSET_ID"
  | "INVALID_ASSET_PATH"
  | "INVALID_PUBLIC_PATH"
  | "INVALID_IMAGE_METADATA"
  | "UNSUPPORTED_ASSET_FORMAT"
  | "ASSET_MEDIA_TYPE_MISMATCH"
  | "DUPLICATE_ASSET_ID"
  | "DUPLICATE_ASSET_PATH"
  | "MISSING_ASSET_FILE"
  | "ASSET_CLIENT_MISMATCH"
  | "UNKNOWN_ASSET_ID";

export interface AssetPipelineErrorDetails {
  readonly code: AssetPipelineErrorCode;
  readonly message: string;
  readonly assetId?: string;
  readonly sourcePath?: string;
  readonly clientId?: string;
  readonly expectedClientId?: string;
}

export class AssetPipelineError extends Error {
  override readonly name = "AssetPipelineError";
  readonly code: AssetPipelineErrorCode;
  readonly assetId: string | undefined;
  readonly sourcePath: string | undefined;
  readonly clientId: string | undefined;
  readonly expectedClientId: string | undefined;

  constructor(details: AssetPipelineErrorDetails) {
    super(details.message);
    this.code = details.code;
    this.assetId = details.assetId;
    this.sourcePath = details.sourcePath;
    this.clientId = details.clientId;
    this.expectedClientId = details.expectedClientId;
  }
}

export function assetError(
  details: AssetPipelineErrorDetails,
): AssetPipelineError {
  return new AssetPipelineError(details);
}
