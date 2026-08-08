from __future__ import annotations
import json,tempfile,unittest
from pathlib import Path
from mlgo_cao_v2.common import PolicyError
from mlgo_cao_v2.evidence import reuse_mode
from mlgo_cao_v2.git_executor import evaluate_required_checks
from mlgo_cao_v2.usage import correlate_registry_usage,enforce_usage_mode

ROOT=Path(__file__).resolve().parents[1]
class CiEvidenceUsageProfilesTest(unittest.TestCase):
 def test_missing_required_ci_fails(self):
  record=evaluate_required_checks(sha='a'*40,required_checks=['CI / validate','Security'],observed_checks=[{'name':'CI / validate','status':'completed','conclusion':'success'}])
  self.assertEqual(record['status'],'FAIL'); self.assertEqual(record['missing_checks'],['Security'])
 def test_neutral_is_not_success_unless_explicit(self):
  bad=evaluate_required_checks(sha='a'*40,required_checks=['CI'],observed_checks=[{'name':'CI','status':'completed','conclusion':'neutral'}])
  good=evaluate_required_checks(sha='a'*40,required_checks=[{'name':'CI','allowed_conclusions':['success','neutral']}],observed_checks=[{'name':'CI','status':'completed','conclusion':'neutral'}])
  self.assertEqual(bad['status'],'FAIL'); self.assertEqual(good['status'],'PASS')
 def test_evidence_reuse_default_disabled(self): self.assertEqual(reuse_mode({}),'disabled')
 def test_enforced_reuse_requires_promotion(self):
  with self.assertRaises(PolicyError): reuse_mode({'validation_evidence':{'reuse_mode':'enforced'}})
 def test_usage_hard_mode_requires_exact_correlation(self):
  with self.assertRaises(PolicyError): enforce_usage_mode({'usage':{'enforcement_mode':'hard'}},{'status':'WARNING_ONLY'})
 def test_codex_registry_correlation_is_exact(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td); rollout=root/'rollout.jsonl'; rollout.write_text('\n'.join([json.dumps({'type':'session_meta','payload':{'id':'sid-1'}}),json.dumps({'payload':{'type':'token_count','info':{'last_token_usage':{'input_tokens':5,'cached_input_tokens':3,'output_tokens':1}}},'timestamp':'2099-01-01T00:00:00Z'})])+'\n')
   registry=root/'registry.json'; registry.write_text(json.dumps({'provider':'codex','provider_session_artifact':str(rollout),'provider_session_id':'sid-1','run_id':'run-1','terminal_id':'term-1'}))
   out=correlate_registry_usage(registry_path=registry,role='supervisor')
   self.assertEqual(out['status'],'EXACT'); self.assertTrue(out['events'][0]['budget_enforcement_eligible'])
 def test_profile_generator_is_single_source_and_exact(self):
  import subprocess,sys
  proc=subprocess.run([sys.executable,str(ROOT/'profile-sources/generate_profiles.py'),'--check','--output',str(ROOT/'profiles')],text=True,capture_output=True)
  self.assertEqual(proc.returncode,0,proc.stderr)
  architect=(ROOT/'profiles/mlgo-claude-subscription-architect.md').read_text(); reviewer=(ROOT/'profiles/mlgo-claude-subscription-reviewer.md').read_text()
  self.assertIn('# MLGO architecture adjudicator',architect); self.assertIn('# MLGO independent phase reviewer',reviewer); self.assertNotEqual(architect.split('---',2)[2],reviewer.split('---',2)[2])
if __name__=='__main__': unittest.main()
