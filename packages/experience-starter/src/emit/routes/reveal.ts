import type { InteractionPlan } from "../../interaction-decisions.js";
import type { RevealRole } from "../../semantic-opportunities.js";

/**
 * The tags that wrap one reveal opportunity, or an empty fragment when this
 * client's entrance appetite does not take an opportunity of this role.
 *
 * Every composition declares every opportunity it has and states what kind of
 * thing is being revealed. Which of them are taken is the client's decision,
 * made once in `planInteractions`, so `entrance: KEY_MOMENTS` and
 * `entrance: EVERY_SECTION` genuinely produce different numbers of moving
 * elements on the same content rather than resolving to the same page.
 */
export function reveal(
  plan: InteractionPlan,
  role: RevealRole,
): { readonly open: string; readonly close: string } {
  if (!plan.reveals(role)) return { open: "<>", close: "</>" };
  return role === "MEDIA"
    ? { open: '<Arrive as="media">', close: "</Arrive>" }
    : { open: "<Arrive>", close: "</Arrive>" };
}

/**
 * Whether any opportunity in this route was taken, which is what decides
 * whether the route imports the helper at all.
 */
export function usesArrive(
  plan: InteractionPlan,
  roles: readonly RevealRole[],
): boolean {
  return roles.some((role) => plan.reveals(role));
}
