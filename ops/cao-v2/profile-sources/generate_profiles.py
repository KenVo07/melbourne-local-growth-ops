#!/usr/bin/env python3
"""Deterministically generate concrete CAO profiles from the canonical registry."""
from __future__ import annotations
import argparse, json, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent
REGISTRY=ROOT.parent/'registry'/'provider-registry.json'
SPECS=ROOT/'profile-specs.json'  # compatibility projection; never independent truth
BODIES=ROOT/'bodies'
DEFAULT_OUT=ROOT.parent/'profiles'

def load_registry() -> dict:
    data=json.loads(REGISTRY.read_text(encoding='utf-8'))
    if data.get('schema_version')!='1.0' or not isinstance(data.get('profiles'),dict):
        raise SystemExit('invalid canonical provider registry')
    return data

def compatibility_specs(data: dict) -> dict:
    return {'schema_version':'1.0','profiles':{name:{'frontmatter':spec['frontmatter'],'body':spec['body']} for name,spec in sorted(data['profiles'].items())}}

def verify_specs_projection(data: dict) -> None:
    expected=compatibility_specs(data)
    actual=json.loads(SPECS.read_text(encoding='utf-8'))
    if actual!=expected:
        raise SystemExit('profile-specs.json drifted from canonical provider registry')

def render(name: str, spec: dict[str,str]) -> str:
    body_path=BODIES/f"{spec['body']}.md"
    if not body_path.is_file(): raise SystemExit(f"missing canonical body: {body_path}")
    fm=spec['frontmatter'].strip(); body=body_path.read_text(encoding='utf-8').strip()
    if not any(line.strip()==f"name: {name}" for line in fm.splitlines()): raise SystemExit(f"frontmatter name mismatch for {name}")
    return f"---\n{fm}\n---\n\n{body}\n"

def generate(out: Path) -> list[Path]:
    data=load_registry(); verify_specs_projection(data)
    out.mkdir(parents=True,exist_ok=True); expected=[]
    for name,spec in sorted(data['profiles'].items()):
        path=out/f'{name}.md'; path.write_text(render(name,spec),encoding='utf-8'); expected.append(path)
    for stale in out.glob('*.md'):
        if stale not in expected: stale.unlink()
    return expected

def check(out: Path) -> None:
    with tempfile.TemporaryDirectory(prefix='mlgo-profile-check-') as td:
        generated=Path(td); generate(generated)
        expected={p.name:p.read_bytes() for p in generated.glob('*.md')}; actual={p.name:p.read_bytes() for p in out.glob('*.md')}
        if expected.keys()!=actual.keys():
            raise SystemExit(f'generated profile set mismatch: missing={sorted(expected.keys()-actual.keys())} extra={sorted(actual.keys()-expected.keys())}')
        drift=[name for name in sorted(expected) if expected[name]!=actual[name]]
        if drift: raise SystemExit('generated profile content drift: '+', '.join(drift))

def main() -> int:
    ap=argparse.ArgumentParser(); ap.add_argument('--output',type=Path,default=DEFAULT_OUT); ap.add_argument('--check',action='store_true')
    args=ap.parse_args(); check(args.output) if args.check else generate(args.output); return 0
if __name__=='__main__': raise SystemExit(main())
