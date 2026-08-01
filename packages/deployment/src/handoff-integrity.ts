import { createHash } from "node:crypto";

export const HANDOFF_MANIFEST_PATH = "handoff-manifest.json";
export const HANDOFF_MANIFEST_DIGEST_PATH = "handoff-manifest.sha256";

export function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === "string"
    ? new TextEncoder().encode(content)
    : new Uint8Array(content);
}

export function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function jsonFile(value: unknown): Uint8Array {
  return toBytes(`${JSON.stringify(value, null, 2)}\n`);
}

export function textContent(content: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return undefined;
  }
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
