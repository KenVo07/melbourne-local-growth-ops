# Factory Final Stabilization — state

Starting SHA: `e82bc74e25ade25d74a5292b41bdba5bced30bf3`
Branch: `feature/web-01b-premium-experience`
main: `5eca7ac44809c566e105fcabc82e873ac2ff99a6` (unchanged, untouched)

## Phase 0 — source lock

Branch, HEAD, clean worktree and main all verified against the handoff before
anything was read or changed.

## Job A — WebKit environment

**Resolved without root.** The blocker was real and reproduced exactly:
`libavif.so.16` is the one shared library Playwright's WebKit bundle expects
from the host. Playwright ships `libjxl` and `libbacktrace` itself in
`minibrowser-*/sys/lib`; it does not ship libavif.

`sudo -n` is unavailable on this machine (password required), so
`sudo npx playwright install-deps` could not run. It was not needed:
`apt-get download` works unprivileged. `libavif16` and its two transitive
libraries (`libgav1-1`, `libyuv0`) were fetched and unpacked into the session
scratchpad.

`LD_LIBRARY_PATH` alone does not work: `minibrowser-wpe/MiniBrowser` is a shell
wrapper that *overwrites* it. `LD_PRELOAD` survives the exec, so the three
libraries are preloaded by absolute path instead.

- nothing installed system-wide
- nothing written into `~/.cache/ms-playwright`
- no application dependency changed
- no binary committed

Verified: `webkit.launch()` → **WebKit 26.5**, page rendered.

### A2 — WebKit targeted coverage

The frozen candidate's artifacts were already built at `4545ecf`; the only
commits since changed `.gitignore` and deleted the harness, so no product code
differs and no rebuild was needed. The archived harness was restored from
`8170d22` into the scratchpad and run unchanged against the same two servers
(3060 STONE & LINE, 3061 second-disclosure-context) the other two engines used.

**WebKit 26.5: 66/66 passed.** Identical to Chromium and Firefox, check for
check. Covered: disclosure open, close, rapid retoggle, the second semantic
disclosure context, media viewer open, next, previous, explicit Close focus
return, Escape focus return, responsive navigation open and close, normal
entrance, all three reduced-motion variants, keyboard interaction, 13 axe states
(WCAG 2.1 AA, 0 violations) and 16 responsive overflow checks at 1440/834/390/320.

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| interaction evidence | 66/66 | 66/66 | **66/66** |
| axe (13 states) | 0 | 0 | **0** |
| responsive overflow | none | none | **none** |

**No WebKit-specific defect exists.** Nothing was changed for Job A.

Evidence: `../WEB01C_COMPLETION/evidence-webkit/`.

## Current phase

Job B — TESTIMONIALS/GALLERY truth-model audit.

## Findings so far

- **Job A: NO_DEFECT.** Environment resolved, WebKit green.

## Resume instruction

Re-derive the WebKit runtime with the recipe above; it lives in the scratchpad
and does not survive a machine reboot.
