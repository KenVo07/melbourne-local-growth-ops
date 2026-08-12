#!/usr/bin/env bash
set -euo pipefail
mode=source; activation=source
while [[ $# -gt 0 ]]; do
  case "$1" in
    --installed) mode=installed; shift ;;
    --activation) activation=${2:?missing activation}; shift 2 ;;
    *) echo "unknown verify option: $1" >&2; exit 2 ;;
  esac
done
src=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [[ "$mode" == source ]]; then
  lib="$src/lib"; policy="$src/config/cao-policy.json"; registry="$src/registry/provider-registry.json"; profiles="$src/profiles"; schemas="$src/schemas"; generator="$src/profile-sources/generate_profiles.py"; examples="$src/examples"
else
  lib="$HOME/.local/lib/mlgo-cao-v2"; registry="$HOME/.local/share/mlgo-cao-v2/registry/provider-registry.json"; schemas="$HOME/.local/share/mlgo-cao-v2/schemas"; generator="$HOME/.local/share/mlgo-cao-v2/profile-sources/generate_profiles.py"; examples="$HOME/.local/share/mlgo-cao-v2/examples"
  if [[ "$activation" == activate-runtime || "$activation" == activate-profiles ]]; then policy="$HOME/.config/mlgo-cao/cao-policy.json"; else policy="$HOME/.local/share/mlgo-cao-v2/staged/cao-policy.json"; fi
  if [[ "$activation" == activate-profiles ]]; then profiles="$HOME/.config/mlgo-cao/profiles"; else profiles="$src/profiles"; fi
fi
export MLGO_CAO_V2_REGISTRY="$registry"

if [[ "$mode" == source ]]; then
 for required in \
  "$src/bin/mlgo-v2-wb0" \
  "$src/lib/mlgo_cao_v2/wb0_bootstrap.py" \
  "$src/lib/mlgo_cao_v2/wb0_capsule.py" \
  "$src/lib/mlgo_cao_v2/wb0_cli.py" \
  "$src/lib/mlgo_cao_v2/wb0_common.py" \
  "$src/lib/mlgo_cao_v2/wb0_instance.py" \
  "$src/lib/mlgo_cao_v2/wb0_manifest.py" \
  "$src/lib/mlgo_cao_v2/wb0_recovery.py" \
  "$src/lib/mlgo_cao_v2/wb0_skills.py" \
  "$src/lib/mlgo_cao_v2/wb0_state.py" \
  "$src/config/wb0-capture-spec.example.json" \
  "$src/config/wb0-instance.example.json" \
  "$src/schemas/wb0-capture-spec.schema.json" \
  "$src/schemas/wb0-instance.schema.json" \
  "$src/schemas/wb0-recovery-transaction.schema.json" \
  "$src/schemas/wb0-release-manifest.schema.json" \
  "$src/schemas/wb0-state-generation.schema.json" \
  "$src/systemd/mlgo-cao-v2-controller.service.in"; do
  [[ -f "$required" ]] || { echo "missing WB-0 source surface: $required" >&2; exit 1; }
 done
fi

PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$lib" python3 - <<'PYVER'
from mlgo_cao_v2 import __version__
expected = "0.5.0-slice3-5-vnext"
assert __version__ == expected, f"runtime version mismatch: {__version__} != {expected}"
print(f"runtime_version={__version__}")
PYVER

python3 "$src/registry/generate_registry_projections.py" --check 2>/dev/null || {
  [[ "$mode" == installed ]] || exit 1
  PYTHONPATH="$lib" python3 - "$registry" "$HOME/.local/share/mlgo-cao-v2/profile-sources/profile-specs.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1])); p=json.load(open(sys.argv[2]))
expected={'schema_version':'1.0','profiles':{n:{'frontmatter':v['frontmatter'],'body':v['body']} for n,v in sorted(r['profiles'].items())}}
assert p==expected,'installed profile-specs projection drift'
PY
}
python3 "$generator" --check --output "$profiles"
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$lib" python3 - "$policy" "$registry" "$schemas" "$profiles" "$examples" <<'PY'
import json,re,sys
from pathlib import Path
from mlgo_cao_v2.policy import load_policy
from mlgo_cao_v2.registry import load_registry, compatibility_profile_specs
policy_path,registry_path,schemas_dir,profiles_dir,examples_dir=map(Path,sys.argv[1:])
r=load_registry(registry_path); policy=load_policy(policy_path,registry_path=registry_path)
schema_paths=sorted(schemas_dir.glob('*.json')); assert schema_paths
for p in schema_paths: json.loads(p.read_text())
required=set(r['profiles'])
for name in sorted(required):
 path=profiles_dir/f'{name}.md'; assert path.is_file(),path; text=path.read_text(); assert text.startswith('---\n') and text.count('---')>=2; assert re.search(rf'(?m)^name:\s*{re.escape(name)}\s*$',text); assert 'Claude Plus Claude' not in text; assert 'MLGO_ASYNC_WORKER_COMPLETION' not in text; assert re.search(r'(?m)^skills:\s*$',text),f'unscoped skills: {path}'
assert {p.stem for p in profiles_dir.glob('*.md')}==required
# All executable route/profile data comes from the canonical registry projection.
for route_id,cfg in r['routes'].items():
 assert cfg['execution_profile_id'] in required
 if cfg.get('reviewer_profile'): assert cfg['reviewer_profile'] in required
# Supervisor and Tech Lead semantic bodies are canonical within each role.
def body(path): return path.read_text().split('---',2)[2].strip()
for role in ('supervisor','tech_lead'):
 names=[n for n,v in r['profiles'].items() if v['role_id']==role]
 assert names and len({body(profiles_dir/f'{n}.md') for n in names})==1,role
try: from jsonschema import Draft202012Validator
except ImportError: Draft202012Validator=None
if Draft202012Validator:
 for example in sorted(examples_dir.glob('*.example.json')):
  stem=example.name.removesuffix('.example.json'); schema=schemas_dir/f'{stem}.schema.json'
  if schema.exists():
   errors=list(Draft202012Validator(json.loads(schema.read_text())).iter_errors(json.loads(example.read_text())))
   assert not errors,f'{example.name}: {errors[0].message}'
print(json.dumps({'policy':str(policy_path),'registry_digest':r['_registry_digest'],'schemas':len(schema_paths),'profiles':len(required),'examples':len(list(examples_dir.glob("*.example.json")))},sort_keys=True))
PY

# The authoritative supervisor must remain an explicit operator choice.
grep -q '^profile=""$' "$src/legacy-replacements/mlgo-supervise"
! grep -q '^profile="mlgo-supervisor"$' "$src/legacy-replacements/mlgo-supervise"

# Slice 2 core modules must stay provider-neutral: continuity, authority,
# episode and envelope semantics may never branch on a concrete provider,
# vendor or web-adapter name.
for f in authority.py checkpoints.py context_envelope.py decisions.py episodes.py; do
 if grep -Eqi '\b(chatgpt|openai|anthropic|claude_code|codex|gemini|kimi|deepseek|agy_sidecar|web_bridge|browser_bridge)\b' "$src/lib/mlgo_cao_v2/$f"; then
  echo "provider-specific identifier leaked into Slice 2 core module: $f" >&2; exit 1
 fi
done

# Slice 2 schema examples are generated from the real constructors.
if [[ "$mode" == source ]]; then PYTHONDONTWRITEBYTECODE=1 python3 "$src/tools/generate_slice2_examples.py" --check; fi

tmp_pycache=$(mktemp -d); trap 'rm -rf "$tmp_pycache"' EXIT
PYTHONPYCACHEPREFIX="$tmp_pycache" PYTHONPATH="$lib" python3 -m compileall -q "$lib/mlgo_cao_v2"
for f in "$src"/bin/* "$src"/legacy-replacements/mlgo-* "$src"/profile-sources/generate_profiles.py "$src"/registry/generate_registry_projections.py "$src"/install.sh "$src"/rollback.sh; do
 [[ -f "$f" ]] || continue
 case "$(head -n1 "$f")" in '#!/usr/bin/env bash') bash -n "$f";; '#!/usr/bin/env python3') PYTHONPYCACHEPREFIX="$tmp_pycache" python3 -m py_compile "$f";; esac
done

if [[ "$mode" == source ]]; then
 (cd "$src" && PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=lib MLGO_CAO_V2_REGISTRY="$registry" python3 -m unittest discover -s tests -v)
else
 # Every staged CAO CLI entrypoint must resolve its own package from its own
 # default path alone. A command that only imports because PYTHONPATH/
 # MLGO_CAO_V2_LIB happen to already be set in the caller's shell is exactly
 # the bug class that let a broken launcher pass every unit test (which always
 # sets PYTHONPATH itself) and only fail at a real host-stage run. Stripping
 # both here means this loop cannot pass on borrowed environment.
 for cmd in mlgo-v2 mlgo-v2-wb0 mlgo-v2-capacity mlgo-v2-route mlgo-v2-dispatch mlgo-v2-controller mlgo-v2-state mlgo-v2-task-lead mlgo-v2-git mlgo-v2-finalize mlgo-v2-usage mlgo-v2-safe-restart mlgo-v2-herdr-preflight mlgo-v2-skill-cache; do
  [[ -x "$HOME/.local/bin/$cmd" ]] || { echo "missing staged command: $cmd" >&2; exit 1; }
  out=$(env -u PYTHONPATH -u MLGO_CAO_V2_LIB "$HOME/.local/bin/$cmd" --help 2>&1) && rc=0 || rc=$?
  if [[ "$rc" -eq 127 ]]; then echo "staged command not executable: $cmd" >&2; exit 1; fi
  if grep -q 'ModuleNotFoundError\|ImportError: \|Traceback (most recent call last)' <<<"$out"; then
   echo "staged command $cmd cannot resolve its own package without a caller-supplied PYTHONPATH/MLGO_CAO_V2_LIB:" >&2
   echo "$out" >&2
   exit 1
  fi
 done
 systemd-analyze --user verify "$HOME/.config/systemd/user/mlgo-cao-v2-controller.service" >/dev/null
 if [[ "$activation" == activate-profiles ]]; then "$HOME/.local/bin/mlgo-sync-cao-profiles" --verify; fi
fi
echo "MLGO CAO v2 verification passed ($mode/$activation)."
