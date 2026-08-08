#!/usr/bin/env python3
"""Generate/check compatibility projections from provider-registry.json."""
from __future__ import annotations
import argparse,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
REGISTRY=Path(__file__).resolve().parent/'provider-registry.json'
PROFILE_SPECS=ROOT/'profile-sources'/'profile-specs.json'

def profile_specs(data):
    return {'schema_version':'1.0','profiles':{name:{'frontmatter':spec['frontmatter'],'body':spec['body']} for name,spec in sorted(data['profiles'].items())}}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--check',action='store_true'); args=ap.parse_args()
    data=json.loads(REGISTRY.read_text()); expected=profile_specs(data)
    if args.check:
        actual=json.loads(PROFILE_SPECS.read_text())
        if actual!=expected: raise SystemExit('profile-specs.json is not the canonical registry projection')
    else:
        PROFILE_SPECS.write_text(json.dumps(expected,indent=2,sort_keys=True)+'\n')
    return 0
if __name__=='__main__': raise SystemExit(main())
