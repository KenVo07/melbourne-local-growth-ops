import { describe, expect, it } from "vitest";

import { validateClientDesignDna } from "./client-design-dna.js";

function fixture(): unknown {
  const dimension = (intent: string) => ({
    intent,
    principles: [`${intent} principle`],
  });
  return {
    schemaVersion: 1,
    designDnaId: "northline-reference",
    designDnaVersion: "1.0.0",
    creativeThesis:
      "Residential electrical craft presented with architectural calm and precise movement.",
    perceptionTargets: ["precise", "premium", "calm"],
    antiTargets: ["generic trade template", "neon technology aesthetic"],
    typography: dimension("Editorial confidence with highly legible body copy."),
    colour: dimension("Warm architectural neutrals with controlled green contrast."),
    composition: dimension("Asymmetric, image-led and route-specific."),
    imagery: dimension("Large project sequences, never fabricated as client proof."),
    interaction: dimension("Direct, tactile and restrained."),
    motion: {
      ...dimension("Mechanical precision that supports Project storytelling."),
      reducedMotionIntent:
        "Replace spatial/parallax movement with immediate state changes and restrained opacity only where useful.",
    },
    responsive: dimension("Recompose and recrop for touch/mobile rather than shrink."),
    signatureIntent: {
      name: "Project aperture",
      purpose: "Reveal Project media as a narrative transition without hiding content.",
    },
  };
}

describe("ClientDesignDnaSchema", () => {
  it("accepts and deeply freezes a concise creative grammar", () => {
    const result = validateClientDesignDna(fixture());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(Object.isFrozen(result.data.motion.principles)).toBe(true);
  });

  it("rejects empty creative dimensions", () => {
    const changed = fixture() as {
      composition: { intent: string; principles: string[] };
    };
    changed.composition.principles = [];
    expect(validateClientDesignDna(changed).success).toBe(false);
  });

  it("rejects arbitrary fields rather than becoming a layout DSL", () => {
    const changed = fixture() as Record<string, unknown>;
    changed.jsx = "<div />";
    expect(validateClientDesignDna(changed).success).toBe(false);
  });
});
