import { describe, expect, it } from "vitest";

import { validateStarterBrief, type StarterInteraction } from "./brief.js";
import { resolveInteraction } from "./decisions.js";
import { quietBrief, loudBrief } from "./fixtures.js";
import {
  decideDisclosure,
  decideProjectMediaTreatment,
  planInteractions,
} from "./interaction-decisions.js";
import type { AccessPattern, DetailRun } from "./semantic-opportunities.js";

/** A run of the given shape, so a rule can be tested without a whole client. */
function run(
  itemCount: number,
  access: AccessPattern = "LOOKUP",
  medianBodyLength = 160,
): DetailRun {
  return {
    key: "questions",
    sectionType: access === "SEQUENCE" ? "PROCESS" : "FAQ",
    label: "Questions",
    access,
    itemCount,
    medianBodyLength,
  };
}

const language: StarterInteraction = {
  tempo: "MEASURED",
  attack: "EASED",
  travel: 0.5,
  overshoot: 0,
  pointerFeedback: "GENEROUS",
  entrance: "EVERY_SECTION",
  disclosure: "WHEN_LONG",
  mediaExploration: "WHEN_PLURAL",
  reducedMotion: "INSTANT",
};

function resolve(interaction?: Partial<StarterInteraction>) {
  return resolveInteraction({
    ...loudBrief,
    ...(interaction === undefined
      ? {}
      : { interaction: { ...language, ...interaction } }),
  });
}

describe("the authored interaction brief", () => {
  it("asks for character, never for engine values", () => {
    /*
     * The point of the whole contract: a delivery specialist writing a brief
     * describes temperament. If a millisecond, a control point or a pixel ever
     * becomes authorable here, the input has stopped being a brief.
     */
    const parsed = validateStarterBrief({ ...loudBrief, interaction: language });
    expect(parsed.success).toBe(true);

    const authored = JSON.stringify(language);
    expect(authored).not.toMatch(/ms|cubic-bezier|rem|px/);
  });

  it("refuses an unknown interaction dimension rather than ignoring it", () => {
    const parsed = validateStarterBrief({
      ...loudBrief,
      interaction: { ...language, durationMs: 240 },
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses a magnitude outside its design range", () => {
    expect(
      validateStarterBrief({
        ...loudBrief,
        interaction: { ...language, travel: 1.4 },
      }).success,
    ).toBe(false);
  });
});

describe("resolving the interaction language", () => {
  it("keeps every legacy brief valid and marks where the language came from", () => {
    expect(validateStarterBrief(quietBrief).success).toBe(true);
    expect(validateStarterBrief(loudBrief).success).toBe(true);
    expect(resolveInteraction(quietBrief).source).toBe("LEGACY_MICRO");
    expect(resolveInteraction(loudBrief).source).toBe("LEGACY_ENTRANCE");
    expect(resolve({}).source).toBe("STRUCTURED");
  });

  /*
   * The A3 floor is founder-approved and already shipped. Regenerating one of
   * those clients has to produce the same motion it produced before, so the
   * legacy ENTRANCE preset is pinned to the exact values A3 hard-coded.
   */
  it("reproduces the A3 entrance floor exactly for a legacy brief", () => {
    const resolved = resolveInteraction(loudBrief);
    expect(resolved.duration.micro).toBe(180);
    expect(resolved.duration.reveal).toBe(540);
    expect(resolved.easing.enter).toBe("cubic-bezier(0.22, 0.61, 0.36, 1)");
    expect(resolved.travel.reveal).toBe("0.75rem");
    expect(resolved.revealFloor).toBe(0);
  });

  it("leaves a NONE brief with nothing to run", () => {
    const still = resolveInteraction({ ...loudBrief, motion: "NONE" });
    expect(still.enabled).toBe(false);
    expect(still.reveals).toBe(false);
    expect(still.travel.reveal).toBe("0rem");
  });

  it("gives a MICRO brief pointer response but no entrance", () => {
    const micro = resolveInteraction(quietBrief);
    expect(micro.enabled).toBe(true);
    expect(micro.reveals).toBe(false);
  });

  it("turns tempo into a whole scale rather than one duration", () => {
    const brisk = resolve({ tempo: "BRISK" }).duration;
    const unhurried = resolve({ tempo: "UNHURRIED" }).duration;
    expect(brisk.micro).toBeLessThan(unhurried.micro);
    expect(brisk.reveal).toBeLessThan(unhurried.reveal);
    // The channels stay in proportion: a tempo is a relationship, not a knob.
    expect(brisk.reveal / brisk.micro).toBeCloseTo(unhurried.reveal / unhurried.micro);
  });

  it("gives exits their own curve so closing resolves rather than reverses", () => {
    const resolved = resolve({});
    expect(resolved.easing.exit).not.toBe(resolved.easing.enter);
  });

  it("applies overshoot to entrances and never to exits", () => {
    const springy = resolve({ overshoot: 1 });
    const flat = resolve({ overshoot: 0 });
    expect(springy.easing.enter).not.toBe(flat.easing.enter);
    expect(springy.easing.enter).toContain("1.4");
    expect(springy.easing.exit).toBe(flat.easing.exit);
  });

  it("fades further the further an element travels", () => {
    expect(resolve({ travel: 0 }).revealFloor).toBeGreaterThan(0);
    expect(resolve({ travel: 1 }).revealFloor).toBe(0);
  });

  /*
   * Every value a pending element can hold has to be one a reader could be
   * shown. A haze it can read is fine; nothing at all is fine; text rendered at
   * five percent is the one outcome that is neither, and it is what an axe run
   * against an unresolved entrance correctly calls a contrast failure.
   */
  it("never leaves a pending element at an opacity between absent and legible", () => {
    for (let travel = 0; travel <= 1.0001; travel += 0.01) {
      const floor = resolve({ travel: Math.round(travel * 100) / 100 }).revealFloor;
      expect(floor === 0 || floor >= 0.35).toBe(true);
    }
  });

  it("removes travel under reduced motion in both intents", () => {
    for (const intent of ["INSTANT", "BRIEF_FADE"] as const) {
      const resolved = resolve({ reducedMotion: intent });
      expect(resolved.reduced.travel).toBe("0rem");
    }
    expect(resolve({ reducedMotion: "INSTANT" }).reduced.fade).toBe(false);
    expect(resolve({ reducedMotion: "BRIEF_FADE" }).reduced.fade).toBe(true);
  });
});

describe("interaction opportunity decisions", () => {
  it("never folds content away for a client that keeps content open", () => {
    const open = resolve({ disclosure: "ALWAYS_VISIBLE" });
    expect(
      decideDisclosure(run(9), open).treatment,
    ).toBe("STATIC");
  });

  it("leaves a short run of questions visible", () => {
    const resolved = resolve({ disclosure: "WHEN_LONG" });
    expect(
      decideDisclosure(run(2), resolved).treatment,
    ).toBe("STATIC");
    expect(
      decideDisclosure(run(3), resolved).treatment,
    ).toBe("PROGRESSIVE_DISCLOSURE");
  });

  /*
   * There is deliberately no rule for the per-service question rail: it lists
   * the questions a customer arrives with and carries no answers, so folding it
   * would open onto nothing. Semantics gate the capability before any client
   * preference is read.
   */
  it("offers no disclosure where the content has nothing behind it", () => {
    const source = planInteractions.toString();
    expect(source).not.toMatch(/serviceQuestion/i);
  });

  it("lets appetite change the answer for identical content", () => {
    const eager = resolve({ disclosure: "PREFERRED" });
    const reticent = resolve({ disclosure: "WHEN_LONG" });
    expect(
      decideDisclosure(run(2), eager).treatment,
    ).toBe("PROGRESSIVE_DISCLOSURE");
    expect(
      decideDisclosure(run(2), reticent).treatment,
    ).toBe("STATIC");
  });

  it("does not build a gallery around a single photograph by default", () => {
    const resolved = resolve({ mediaExploration: "WHEN_PLURAL" });
    expect(
      decideProjectMediaTreatment({ mediaCount: 1, interaction: resolved })
        .treatment,
    ).toBe("STATIC");
    expect(
      decideProjectMediaTreatment({ mediaCount: 2, interaction: resolved })
        .treatment,
    ).toBe("DIALOG_EXPLORER");
  });

  it("keeps media editorial when the client asks for it", () => {
    const resolved = resolve({ mediaExploration: "EDITORIAL_ONLY" });
    expect(
      decideProjectMediaTreatment({ mediaCount: 6, interaction: resolved })
        .treatment,
    ).toBe("STATIC");
  });

  it("explains every decision it makes", () => {
    const resolved = resolve({});
    for (const decision of [
      decideDisclosure(run(1), resolved),
      decideDisclosure(run(8), resolved),
      decideProjectMediaTreatment({ mediaCount: 4, interaction: resolved }),
    ]) {
      expect(decision.reason.length).toBeGreaterThan(20);
    }
  });

  /*
   * The finding this suite exists to answer: does the generator reason about
   * how content is *used*, or has it simply learned the word FAQ? Three runs of
   * identical structure, one of which must be refused.
   */
  it("refuses to fold an ordered sequence however long and however eager", () => {
    const eager = resolve({ disclosure: "PREFERRED" });
    expect(decideDisclosure(run(9, "SEQUENCE"), eager).treatment).toBe("STATIC");
    expect(decideDisclosure(run(9, "SEQUENCE"), eager).reason).toMatch(
      /ordered sequence/,
    );
    // Same client, same item count, same body length — only the access differs.
    expect(decideDisclosure(run(9, "LOOKUP"), eager).treatment).toBe(
      "PROGRESSIVE_DISCLOSURE",
    );
  });

  it("refuses to fold a run a reader is comparing side by side", () => {
    const eager = resolve({ disclosure: "PREFERRED" });
    expect(decideDisclosure(run(9, "BROWSE"), eager).treatment).toBe("STATIC");
  });

  it("refuses to fold a run of one-line items, which is a table", () => {
    const eager = resolve({ disclosure: "PREFERRED" });
    expect(decideDisclosure(run(9, "LOOKUP", 12), eager).treatment).toBe(
      "STATIC",
    );
    expect(decideDisclosure(run(9, "LOOKUP", 200), eager).treatment).toBe(
      "PROGRESSIVE_DISCLOSURE",
    );
  });

  it("decides from content shape and language, never from the Profile", () => {
    const source = decideDisclosure.toString();
    expect(source).not.toMatch(/profile/i);
  });
});
