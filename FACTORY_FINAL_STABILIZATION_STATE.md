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

## Current phase

Job A2 — targeted WEB-01C WebKit smoke coverage.

## Findings so far

_(none recorded yet)_

## Resume instruction

Re-derive the WebKit runtime with the recipe above; it lives in the scratchpad
and does not survive a machine reboot.
