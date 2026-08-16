import { describe, expect, it } from "vitest";

import {
  mediaObjectPosition,
  validateWebsiteMediaReference,
} from "./media-reference.js";

describe("website media reference", () => {
  it("accepts client-owned alt text and responsive focal points", () => {
    const result = validateWebsiteMediaReference({
      assetId: "projects/northcote/hero",
      role: "PROJECT",
      decorative: false,
      alt: "Warm architectural lighting across a renovated living room",
      caption: "Representative concept imagery for the fictional fixture.",
      presentation: {
        aspect: "PANORAMIC",
        fit: "COVER",
        focalPoint: { x: 0.62, y: 0.45 },
        mobile: {
          aspect: "PORTRAIT",
          focalPoint: { x: 0.72, y: 0.38 },
        },
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(mediaObjectPosition(result.data, "DESKTOP")).toBe("62% 45%");
    expect(mediaObjectPosition(result.data, "MOBILE")).toBe("72% 38%");
  });

  it("requires useful alt text for informative media", () => {
    const result = validateWebsiteMediaReference({
      assetId: "hero",
      role: "HERO",
      decorative: false,
      alt: "",
      presentation: { aspect: "LANDSCAPE", fit: "COVER" },
    });
    expect(result.success).toBe(false);
  });

  it("requires decorative media to use an empty alt and no caption", () => {
    const result = validateWebsiteMediaReference({
      assetId: "texture",
      role: "DECORATIVE",
      decorative: true,
      alt: "Decorative grain",
      caption: "Should not exist",
      presentation: { aspect: "NATURAL", fit: "COVER" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects focal points outside the normalized range", () => {
    const result = validateWebsiteMediaReference({
      assetId: "hero",
      role: "HERO",
      decorative: false,
      alt: "Electrician installing a pendant light",
      presentation: {
        aspect: "LANDSCAPE",
        fit: "COVER",
        focalPoint: { x: 1.2, y: -0.1 },
      },
    });
    expect(result.success).toBe(false);
  });
});
