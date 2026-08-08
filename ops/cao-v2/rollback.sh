#!/usr/bin/env bash
set -euo pipefail
usage(){ echo 'usage: rollback.sh --apply --backup PATH' >&2; exit 2; }
apply=false; backup=""
while [[ $# -gt 0 ]]; do case "$1" in --apply) apply=true; shift;; --backup) [[ $# -ge 2 ]]||usage; backup=$2; shift 2;; *) usage;; esac; done
$apply || usage
[[ -d "$backup" && -f "$backup/restore.tsv" && -f "$backup/phase.json" ]] || { echo "invalid backup: $backup" >&2; exit 1; }
phase=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["phase"])' "$backup/phase.json")

# Rollback of runtime/profile activation changes future execution and therefore
# requires a known-empty resource inventory. Stage-only rollback is additive but
# is also refused if the staged controller is active.
if [[ "$phase" != stage-only ]]; then
  policy="$HOME/.local/share/mlgo-cao-v2/staged/cao-policy.json"
  [[ -f "$policy" ]] || policy="$HOME/.config/mlgo-cao/cao-policy.json"
  PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$HOME/.local/lib/mlgo-cao-v2" python3 - "$policy" <<'PY'
import json,sys
from mlgo_cao_v2.policy import load_policy
from mlgo_cao_v2.restart import active_resources
r=active_resources(load_policy(sys.argv[1])); print(json.dumps(r,indent=2,sort_keys=True))
if r.get('restart_blocked'): raise SystemExit('active or unknown resources block rollback')
PY
fi

if [[ "$phase" == activate-runtime || "$phase" == stage-only ]]; then
  systemctl --user stop mlgo-cao-v2-controller.service 2>/dev/null || true
  systemctl --user disable mlgo-cao-v2-controller.service 2>/dev/null || true
fi
while IFS=$'\t' read -r dest saved; do
  [[ -n "$dest" ]] || continue
  rm -rf "$dest"
  if [[ "$saved" != '-' ]]; then mkdir -p "$(dirname "$dest")"; cp -a "$saved" "$dest"; fi
done < <(tac "$backup/restore.tsv")
systemctl --user daemon-reload

# Restore exact prior unit enable/active state when it was captured.
if [[ -f "$backup/unit-state.json" ]]; then
  enabled=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("enabled",""))' "$backup/unit-state.json")
  active=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("active",""))' "$backup/unit-state.json")
  [[ "$enabled" == enabled ]] && systemctl --user enable mlgo-cao-v2-controller.service >/dev/null 2>&1 || true
  [[ "$active" == active ]] && systemctl --user start mlgo-cao-v2-controller.service >/dev/null 2>&1 || true
fi
if [[ "$phase" == activate-profiles && -x "$HOME/.local/bin/mlgo-sync-cao-profiles" ]]; then
  "$HOME/.local/bin/mlgo-sync-cao-profiles" --verify >/dev/null || { echo 'restored profile stores do not verify; no service was restarted' >&2; exit 1; }
fi
cat <<EOF
Rollback phase restored: $phase
Backup: $backup
The main CAO, sidecar, watcher and provider sessions were not restarted.
EOF
