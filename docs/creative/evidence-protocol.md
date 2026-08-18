# Evidence protocol

What a creative delivery must capture, so a decision can be reviewed later by
someone who was not there.

## Principle

Evidence exists to make judgement possible, not to prove diligence. Every item
below answers a question a reviewer will actually ask. Anything that answers no
question is not worth capturing.

## 1. Static visual evidence

At **1440 / 834 / 390 / 320** — the widths the Factory already validates against,
so creative evidence and platform evidence are comparable.

- every route, at every width;
- both the opening state and a scrolled state where composition changes;
- any state a reader can reach: menu open, disclosure expanded, media overlay open,
  form submitted, form in error.

## 2. Temporal evidence

Screenshots cannot show motion craft, and motion craft is most of what
distinguishes a considered site.

- a recording of the Signature performing its full behaviour;
- the entrance sequence of at least one route;
- one interaction from rest through response and back to rest;
- anything that responds continuously to scroll or pointer.

Record at desktop and at 390px. A Signature that was only ever recorded at desktop
has not been reviewed on mobile.

## 3. Reduced-motion evidence

Captured separately, always, with `prefers-reduced-motion: reduce` set.

The question a reviewer is asking: **does this look like a designed state, or like
the page failed?** Capture the same routes and states as §1, and confirm that
open/closed/selected/submitted meaning survives and no content is hidden.

## 4. Responsive evidence

Beyond the static set:

- no horizontal overflow at any of the four widths;
- art-directed crops still meaningful at narrow aspect;
- the Signature's designed small form, or its deliberate absence;
- the conversion reachable without an unreasonable scroll.

## 5. Accessibility evidence

- automated accessibility results per engine, per significant state;
- a keyboard traversal recording of the conversion path;
- visible focus on every interactive element, including bespoke Signature controls.

Bespoke Signature controls are where this fails. A platform primitive carries its
own behaviour; a hand-built one carries whatever it was given.

## 6. Performance and runtime evidence

- production build output for the standalone artifact;
- the client JavaScript actually shipped, and by which route;
- runtime cost of the Signature — scroll and animation behaviour under load;
- confirmation that clients not using a capability do not pay for it.

That last one is a boundary check, not a performance nicety: a Signature that
adds global runtime cost to unrelated clients is an architecture failure.

## 7. Decision evidence

The part most often skipped, and the part most valuable a year later.

- **all three territories**, including the two not selected;
- **why the selected one won**, in the founder's words;
- **why each rejected one lost** — this prevents re-exploring the same dead end;
- the fresh-eyes red team findings, and what was done about each;
- the Creative Gate decision, its named fixes, and the candidate commit.

## 8. Production translation evidence

After the build:

- `translation_delta` — what changed between approved prototype and shipped
  implementation, and why;
- which `prototype_fakes` were replaced, and with what;
- any technique swapped because the envelope refused the original;
- the promotion ledger entry for every bespoke mechanic.

## Where it lives

Alongside the delivery's creative artifacts, in a directory the Creative Gate can
name. Evidence that cannot be pointed at from the gate decision is evidence
nobody will find.
