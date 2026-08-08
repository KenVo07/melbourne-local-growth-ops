#!/usr/bin/env bash
set -euo pipefail

usage(){ cat >&2 <<'EOF'
usage:
  install.sh --stage-only (--dry-run|--apply)
  install.sh --activate-runtime (--dry-run|--apply) [--start-controller]
  install.sh --activate-profiles (--dry-run|--apply)

The phases are intentionally separate. Stage-only is additive and does not
replace profiles, provider wrappers, mlgo-supervise, or start any service.
EOF
exit 2; }

phase=""; action=""; start_controller=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage-only|--activate-runtime|--activate-profiles) [[ -z "$phase" ]] || usage; phase=${1#--} ;;
    --dry-run|--apply) [[ -z "$action" ]] || usage; action=${1#--} ;;
    --start-controller) start_controller=true ;;
    -h|--help) usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
  shift
done
[[ -n "$phase" && -n "$action" ]] || usage
[[ "$phase" == "activate-runtime" || "$start_controller" == false ]] || usage

src=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
stage_root="$HOME/.local/share/mlgo-cao-v2"
state_dir="$HOME/.local/state/mlgo-cao/installations"
state_file="$state_dir/v2-install-state.json"

plan(){ printf '%-12s %s\n' "$1" "$2"; }
changed(){ local s=$1 d=$2; [[ ! -e "$d" ]] || ! cmp -s "$s" "$d"; }

list_stage(){
  plan INSTALL "$HOME/.local/lib/mlgo-cao-v2/mlgo_cao_v2"
  plan INSTALL "$stage_root/staged/cao-policy.json"
  plan INSTALL "$stage_root/schemas"
  plan INSTALL "$stage_root/examples"
  plan INSTALL "$stage_root/profile-sources"
  plan INSTALL "$stage_root/registry"
  plan INSTALL "$HOME/.local/bin/mlgo-v2*"
  plan INSTALL "$HOME/.config/systemd/user/mlgo-cao-v2-controller.service (disabled)"
  plan PRESERVE "$HOME/.config/mlgo-cao/profiles"
  plan PRESERVE "$HOME/.local/bin/mlgo-supervise and provider wrappers"
  plan PRESERVE "all running services and provider sessions"
}
list_runtime(){
  plan ACTIVATE "$HOME/.config/mlgo-cao/cao-policy.json"
  plan ENABLE "mlgo-cao-v2-controller.service"
  $start_controller && plan START "mlgo-cao-v2-controller.service" || plan PRESERVE "controller stopped"
  plan PRESERVE "main CAO, sidecar, watcher and profile stores"
}
list_profiles(){
  plan GENERATE "$HOME/.config/mlgo-cao/profiles/*.md from canonical role bodies"
  plan ACTIVATE "$HOME/.local/bin/mlgo-supervise, mlgo-sync-cao-profiles and Claude effort wrappers"
  plan SYNC "main and AGY profile stores"
  plan PRESERVE "all services; no restart"
}

if [[ "$action" == dry-run ]]; then
  echo "MLGO CAO v2 installation plan: $phase"
  case "$phase" in stage-only) list_stage;; activate-runtime) list_runtime;; activate-profiles) list_profiles;; esac
  exit 0
fi

# Source verification is safe and must pass before any write.
"$src/verify.sh"

# Re-staging code underneath an already-running v2 controller could change its
# imports mid-process.  Stage-only is additive for the first installation, but
# it still fails closed when an earlier staged controller is active.
if [[ "$phase" == stage-only ]] && systemctl --user is-active --quiet mlgo-cao-v2-controller.service 2>/dev/null; then
  echo 'stage-only refused: mlgo-cao-v2-controller.service is active' >&2
  exit 1
fi

require_staged(){
  [[ -f "$stage_root/staged/cao-policy.json" && -f "$stage_root/registry/provider-registry.json" && -d "$HOME/.local/lib/mlgo-cao-v2/mlgo_cao_v2" ]] || { echo 'stage-only installation is required first' >&2; exit 1; }
}
check_resources(){
  require_staged
  PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$HOME/.local/lib/mlgo-cao-v2" python3 - "$stage_root/staged/cao-policy.json" <<'PY'
import json,sys
from mlgo_cao_v2.policy import load_policy
from mlgo_cao_v2.restart import active_resources
r=active_resources(load_policy(sys.argv[1]))
print(json.dumps(r,indent=2,sort_keys=True))
if r.get('restart_blocked'):
    raise SystemExit('active or unknown resources block activation')
PY
}

[[ "$phase" == stage-only ]] || check_resources
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$HOME/.local/state/mlgo-cao/backups/v2-install/$stamp-$phase"
record="$state_dir/v2-$stamp-$phase.json"
mkdir -p "$backup" "$state_dir"; chmod 700 "$backup" "$state_dir"
manifest="$backup/restore.tsv"; : > "$manifest"; chmod 600 "$manifest"
python3 - "$backup/phase.json" "$phase" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({"schema_version":"1.0","phase":sys.argv[2]},indent=2)+"\n")
PY
chmod 600 "$backup/phase.json"

backup_one(){
  local dest=$1
  local rel=${dest#/}
  if [[ -e "$dest" || -L "$dest" ]]; then
    mkdir -p "$backup/rootfs/$(dirname "$rel")"; cp -a "$dest" "$backup/rootfs/$rel"; printf '%s\t%s\n' "$dest" "$backup/rootfs/$rel" >> "$manifest"
  else printf '%s\t-\n' "$dest" >> "$manifest"; fi
}
install_one(){ local source=$1 dest=$2 mode=$3; backup_one "$dest"; install -D -m "$mode" "$source" "$dest"; }
restore_partial(){
  local rc=$?
  trap - ERR
  set +e
  while IFS=$'\t' read -r dest saved; do
    [[ -n "$dest" ]] || continue
    rm -rf "$dest"
    if [[ "$saved" != '-' ]]; then mkdir -p "$(dirname "$dest")"; cp -a "$saved" "$dest"; fi
  done < <(tac "$manifest")

  # Restore the controller unit's pre-phase enable/active state as part of the
  # same rollback domain. File restoration alone is incomplete after
  # daemon-reload/enable/disable/start operations.
  if [[ -f "$backup/unit-state.json" ]]; then
    read -r previous_enabled previous_active < <(python3 - "$backup/unit-state.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]))
print(v.get('enabled','unknown'),v.get('active','unknown'))
PY
)
    case "$previous_enabled" in
      enabled|enabled-runtime|linked|linked-runtime) systemctl --user enable mlgo-cao-v2-controller.service >/dev/null 2>&1 ;;
      disabled) systemctl --user disable mlgo-cao-v2-controller.service >/dev/null 2>&1 ;;
    esac
    case "$previous_active" in
      active|activating) systemctl --user start mlgo-cao-v2-controller.service >/dev/null 2>&1 ;;
      inactive|failed|deactivating) systemctl --user stop mlgo-cao-v2-controller.service >/dev/null 2>&1 ;;
    esac
    systemctl --user daemon-reload >/dev/null 2>&1
  fi

  python3 - "$record" "$state_file" "$phase" "$backup" "$rc" <<'PY'
import json,sys
from pathlib import Path
record,state,phase,backup,rc=sys.argv[1:]
entry={'phase':phase,'status':'ROLLED_BACK_AFTER_PARTIAL_FAILURE','backup':backup,'exit_code':int(rc)}
Path(record).write_text(json.dumps({'schema_version':'2.1',**entry},indent=2,sort_keys=True)+'\n')
try: current=json.loads(Path(state).read_text())
except Exception: current={'schema_version':'2.1','staged':False,'runtime_activated':False,'profiles_activated':False,'history':[]}
current.setdefault('history',[]).append(entry)
Path(state).parent.mkdir(parents=True,exist_ok=True)
Path(state).write_text(json.dumps(current,indent=2,sort_keys=True)+'\n')
PY
  chmod 600 "$record" "$state_file" 2>/dev/null
  echo "installation phase failed and was rolled back: $phase" >&2
  exit "$rc"
}
trap restore_partial ERR

if [[ "$phase" == "activate-runtime" || "$phase" == "stage-only" ]]; then
  python3 - "$backup/unit-state.json" "$(systemctl --user is-enabled mlgo-cao-v2-controller.service 2>/dev/null || true)" "$(systemctl --user is-active mlgo-cao-v2-controller.service 2>/dev/null || true)" <<'PY'
import json,sys
from pathlib import Path
Path(sys.argv[1]).write_text(json.dumps({'enabled':sys.argv[2],'active':sys.argv[3]},indent=2)+'\n')
PY
fi

case "$phase" in
  stage-only)
    backup_one "$HOME/.local/lib/mlgo-cao-v2"; rm -rf "$HOME/.local/lib/mlgo-cao-v2"; mkdir -p "$HOME/.local/lib/mlgo-cao-v2/mlgo_cao_v2"; cp -a "$src/lib/mlgo_cao_v2/." "$HOME/.local/lib/mlgo-cao-v2/mlgo_cao_v2/"
    find "$HOME/.local/lib/mlgo-cao-v2" -type d -name __pycache__ -prune -exec rm -rf {} +; chmod -R go-rwx "$HOME/.local/lib/mlgo-cao-v2"
    backup_one "$stage_root"; rm -rf "$stage_root"; mkdir -p "$stage_root/staged"; cp -a "$src/schemas" "$src/examples" "$src/profile-sources" "$src/registry" "$stage_root/"; cp "$src/config/cao-policy.json" "$stage_root/staged/cao-policy.json"; chmod -R go-rwx "$stage_root"
    for source in "$src"/bin/*; do install_one "$source" "$HOME/.local/bin/$(basename "$source")" 700; done
    install_one "$src/systemd/mlgo-cao-v2-controller.service" "$HOME/.config/systemd/user/mlgo-cao-v2-controller.service" 600
    systemctl --user disable mlgo-cao-v2-controller.service >/dev/null 2>&1 || true
    systemctl --user daemon-reload
    ;;
  activate-runtime)
    install_one "$stage_root/staged/cao-policy.json" "$HOME/.config/mlgo-cao/cao-policy.json" 600
    systemctl --user daemon-reload; systemctl --user enable mlgo-cao-v2-controller.service >/dev/null
    $start_controller && systemctl --user start mlgo-cao-v2-controller.service
    ;;
  activate-profiles)
    [[ -f "$HOME/.config/mlgo-cao/cao-policy.json" ]] || { echo 'activate-runtime is required before activate-profiles' >&2; exit 1; }
    tmp=$(mktemp -d); python3 "$stage_root/profile-sources/generate_profiles.py" --output "$tmp"
    # Profile activation is one rollback domain: canonical source and both installed stores.
    backup_one "$HOME/.config/mlgo-cao/profiles"
    backup_one "$HOME/.aws/cli-agent-orchestrator/agent-store"
    backup_one "$HOME/.aws/cli-agent-orchestrator/agent-context"
    backup_one "$HOME/.local/state/mlgo-cao/agy-sidecar/cao-home/agent-store"
    rm -rf "$HOME/.config/mlgo-cao/profiles"; mkdir -p "$HOME/.config/mlgo-cao/profiles"; chmod 700 "$HOME/.config/mlgo-cao/profiles"
    for source in "$tmp"/*.md; do install -D -m 600 "$source" "$HOME/.config/mlgo-cao/profiles/$(basename "$source")"; done
    rm -rf "$tmp"
    for name in mlgo-claude-subscription-medium mlgo-claude-subscription-high mlgo-claude-gateway-medium mlgo-claude-gateway-high mlgo-sync-cao-profiles mlgo-supervise; do install_one "$src/legacy-replacements/$name" "$HOME/.local/bin/$name" 700; done
    "$HOME/.local/bin/mlgo-sync-cao-profiles" --all >/dev/null
    ;;
esac

# The rollback trap intentionally remains armed through installed verification.
# No APPLIED record or activation bit is written until the installed surface is
# proven consistent for this exact phase.
"$src/verify.sh" --installed --activation "$phase"

python3 - "$record" "$state_file" "$phase" "$backup" "$start_controller" <<'PY'
import json,sys
from pathlib import Path
record,state,phase,backup,start=sys.argv[1:]
try: current=json.loads(Path(state).read_text())
except Exception: current={'schema_version':'2.1','staged':False,'runtime_activated':False,'profiles_activated':False,'history':[]}
if phase=='stage-only': current['staged']=True
elif phase=='activate-runtime': current['runtime_activated']=True
elif phase=='activate-profiles': current['profiles_activated']=True
entry={'phase':phase,'status':'APPLIED','backup':backup,'controller_started':start=='true','installed_verification':'PASS'}
current.setdefault('history',[]).append(entry)
Path(state).write_text(json.dumps(current,indent=2,sort_keys=True)+'\n')
Path(record).write_text(json.dumps({'schema_version':'2.1',**entry},indent=2,sort_keys=True)+'\n')
PY
chmod 600 "$record" "$state_file"
trap - ERR
cat <<EOF
MLGO CAO v2 phase applied: $phase
Backup: $backup
Record: $record
No main CAO, sidecar, watcher or provider session was restarted.
EOF
