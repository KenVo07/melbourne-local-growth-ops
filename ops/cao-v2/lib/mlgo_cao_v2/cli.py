"""Command-line interface for the MLGO CAO v2 selective-remediation layer."""
from __future__ import annotations

import argparse, json, sys
from pathlib import Path
from typing import Any

from .canonical_lock import load_lock, population_plan
from .canary_scope import close_scope, open_scope, status as canary_status
from .capacity import create_snapshot, set_manual_hint
from .common import MLGOError, atomic_write_json, iso_now, load_json
from .contracts import load_and_validate
from .continuity import begin_checkpoint_fallback, complete_same_session_recovery, plan_recovery, register_session
from .controller import process_event, process_run_once, run_forever
from .completion import preflight_herdr_boundary
from .dispatch import run_job, submit_phase
from .dispatch_governance import qualify_child_transport_provider, QualificationEvidenceInvalid
from .finalization import finalize_with_verdict, prepare_final_facts
from .git_executor import commit_task, create_pull_request, integrate_commit, push_branch, verify_ci, verify_reachability
from .policy import load_policy
from .registry import compatibility_policy_routes, load_registry, resolve_registry_path
from .provenance import capture_supervisor_decision, create_delivery, parse_model_artifact_observation, record_manual_observation, record_model_observation
from .restart import active_resources, active_runs, guarded_restart
from .routing import decide_route
from .skill_cache import SealedSkillCache
from .skill_population import bind_namespace, populate_cache, project_native_mirror, verify_native_mirror
from .state_machine import RunStore
from .task_lead import notify_supervisor, start_task_lead
from .usage import agy_usage_placeholder, append_usage_event, claude_transcript_events, codex_rollout_events, correlate_registry_usage, enforce_usage_mode


def _print(value: Any) -> None: print(json.dumps(value, indent=2, sort_keys=True))
def _json_list(value: str) -> list[str]:
    parsed=json.loads(value)
    if not isinstance(parsed,list) or not all(isinstance(x,str) for x in parsed): raise argparse.ArgumentTypeError('expected JSON array of strings')
    return parsed

def _json_value(value: str) -> Any:
    try: return json.loads(value)
    except json.JSONDecodeError as exc: raise argparse.ArgumentTypeError(str(exc)) from exc

def _policy_arg(p: argparse.ArgumentParser) -> None: p.add_argument('--policy',default=None)
def _write_optional(path: str|None, value: dict[str,Any]) -> None:
    if path: atomic_write_json(Path(path),value)

def build_parser() -> argparse.ArgumentParser:
    ap=argparse.ArgumentParser(prog='mlgo-v2',description=__doc__); sub=ap.add_subparsers(dest='command',required=True)
    p=sub.add_parser('init-run'); p.add_argument('--run-id',required=True); p.add_argument('--mode',choices=('legacy','v2_shadow','v2_enforced'),default='v2_shadow'); p.add_argument('--supervisor-profile',required=True); _policy_arg(p)
    p=sub.add_parser('show-state'); p.add_argument('--run-id',required=True); _policy_arg(p)
    p=sub.add_parser('registry-info'); p.add_argument('--registry'); _policy_arg(p)
    p=sub.add_parser('repair-state'); p.add_argument('--run-id',required=True); _policy_arg(p)
    p=sub.add_parser('set-run-status'); p.add_argument('--run-id',required=True); p.add_argument('--status',choices=('ACTIVE','PAUSED','PUBLICATION_PENDING','FINAL_FACTS_READY','FINALIZATION_PENDING','FINALIZED','FAILED','CANCELLED'),required=True); p.add_argument('--reason',required=True); _policy_arg(p)
    p=sub.add_parser('register-charter'); p.add_argument('--run-id',required=True); p.add_argument('--charter',required=True); p.add_argument('--task-lead-id'); _policy_arg(p)
    p=sub.add_parser('transition-phase'); p.add_argument('--run-id',required=True); p.add_argument('--phase-id',required=True); p.add_argument('--target',required=True); p.add_argument('--reason',default='operator or host transition'); p.add_argument('--expected-version',type=int); _policy_arg(p)
    p=sub.add_parser('capacity'); p.add_argument('--run-id'); p.add_argument('--supervisor-profile'); p.add_argument('--gateway-authorized',action='store_true'); p.add_argument('--output'); _policy_arg(p)
    p=sub.add_parser('capacity-hint'); p.add_argument('--account-pool',required=True); p.add_argument('--band',choices=('abundant','healthy','constrained','protected','exhausted','unknown'),required=True); p.add_argument('--ttl-seconds',type=int,default=21600); p.add_argument('--reason',required=True); p.add_argument('--operator-identity',required=True); _policy_arg(p)
    p=sub.add_parser('route'); p.add_argument('--proposal',required=True); p.add_argument('--charter',required=True); p.add_argument('--snapshot',required=True); p.add_argument('--output'); _policy_arg(p)
    p=sub.add_parser('submit-phase'); p.add_argument('--phase',required=True); p.add_argument('--shadow',action='store_true'); _policy_arg(p)
    p=sub.add_parser('run-job',help=argparse.SUPPRESS); p.add_argument('--job-file',required=True); _policy_arg(p)
    p=sub.add_parser('qualify-provider',help='explicit, disposable qualification ceremony: parse+validate real captured provider evidence and bind a QUALIFIED native-preauthorization record to the currently measured provider/wrapper identity'); p.add_argument('--provider',choices=('claude_code','codex'),required=True); p.add_argument('--profile',required=True); p.add_argument('--evidence',required=True); p.add_argument('--launch-argv'); p.add_argument('--registry'); _policy_arg(p)
    p=sub.add_parser('controller-once'); p.add_argument('--run-id',required=True); _policy_arg(p)
    p=sub.add_parser('controller-event'); p.add_argument('--event',required=True); _policy_arg(p)
    p=sub.add_parser('controller-serve'); p.add_argument('--interval',type=float,default=2.0); _policy_arg(p)
    p=sub.add_parser('start-task-lead'); p.add_argument('--run-id',required=True); p.add_argument('--big-task-id',required=True); p.add_argument('--task-lead-id',required=True); p.add_argument('--charter',required=True); p.add_argument('--profile',required=True); p.add_argument('--main-session',default='mlgo-cao'); p.add_argument('--supervisor-terminal-id'); p.add_argument('--recovery-checkpoint'); p.add_argument('--gateway-authorized',action='store_true'); _policy_arg(p)
    p=sub.add_parser('notify-supervisor'); p.add_argument('--run-id',required=True); p.add_argument('--big-task-id',required=True); p.add_argument('--packet',required=True); p.add_argument('--supervisor-terminal-id',required=True); _policy_arg(p)

    p=sub.add_parser('git-commit'); p.add_argument('--worktree',required=True); p.add_argument('--branch',required=True); p.add_argument('--allowed-paths',type=_json_list,required=True); p.add_argument('--forbidden-paths',type=_json_list,default=[]); p.add_argument('--message',required=True); p.add_argument('--operation-id'); p.add_argument('--output')
    p=sub.add_parser('git-integrate'); p.add_argument('--worktree',required=True); p.add_argument('--branch',required=True); p.add_argument('--commit',required=True); p.add_argument('--output')
    p=sub.add_parser('git-push'); p.add_argument('--worktree',required=True); p.add_argument('--remote',default='origin'); p.add_argument('--branch',required=True); p.add_argument('--sha',required=True); p.add_argument('--output')
    p=sub.add_parser('git-pr'); p.add_argument('--repository',required=True); p.add_argument('--head',required=True); p.add_argument('--base',required=True); p.add_argument('--title',required=True); p.add_argument('--body-file',required=True); p.add_argument('--output')
    p=sub.add_parser('git-reachability'); p.add_argument('--repository',required=True); p.add_argument('--remote',default='origin'); p.add_argument('--branch',required=True); p.add_argument('--sha',required=True); p.add_argument('--output')
    p=sub.add_parser('git-ci'); p.add_argument('--repository',required=True); p.add_argument('--sha',required=True); p.add_argument('--required-checks',type=_json_value,required=True); p.add_argument('--timeout-seconds',type=int,default=1800); p.add_argument('--output')

    p=sub.add_parser('prepare-final-facts'); p.add_argument('--run-id',required=True); p.add_argument('--integration-worktree',required=True); p.add_argument('--target-branch',required=True); p.add_argument('--expected-sha',required=True); p.add_argument('--review-record',required=True); p.add_argument('--final-validation-record',required=True); p.add_argument('--publication-authorization',required=True); p.add_argument('--publication-record'); p.add_argument('--remote-ci-record'); p.add_argument('--required-ci-checks',type=_json_value); p.add_argument('--publication-not-required',action='store_true'); p.add_argument('--ci-not-required',action='store_true'); p.add_argument('--remote',default='origin'); _policy_arg(p)
    p=sub.add_parser('finalize'); p.add_argument('--run-id',required=True); p.add_argument('--final-facts-record',required=True); p.add_argument('--final-verdict',required=True); _policy_arg(p)

    p=sub.add_parser('delivery-create'); p.add_argument('--run-id',required=True); p.add_argument('--recipient-role',required=True); p.add_argument('--terminal-id',required=True); p.add_argument('--profile',required=True); p.add_argument('--generation',type=int,required=True); p.add_argument('--provider',required=True); p.add_argument('--provider-session-id'); p.add_argument('--payload-file',required=True); p.add_argument('--delivery-id'); _policy_arg(p)
    p=sub.add_parser('delivery-observe'); p.add_argument('--run-id',required=True); p.add_argument('--delivery-id',required=True); p.add_argument('--source',choices=('provider_rollout','provider_transcript','cao_model_event'),required=True); p.add_argument('--artifact',required=True); p.add_argument('--ack-record-index',type=int,required=True); p.add_argument('--response-record-index',type=int); _policy_arg(p)
    p=sub.add_parser('delivery-observe-manual'); p.add_argument('--run-id',required=True); p.add_argument('--delivery-id',required=True); p.add_argument('--observed-text-file',required=True); p.add_argument('--response-text-file'); p.add_argument('--source-note',default='manual'); _policy_arg(p)
    p=sub.add_parser('capture-supervisor-decision'); p.add_argument('--run-id',required=True); p.add_argument('--decision-packet',required=True); p.add_argument('--delivery-id',required=True); _policy_arg(p)

    p=sub.add_parser('continuity-register'); p.add_argument('--run-id',required=True); p.add_argument('--profile',required=True); p.add_argument('--generation',type=int,required=True); p.add_argument('--terminal-id',required=True); p.add_argument('--provider',required=True); p.add_argument('--provider-session-id'); p.add_argument('--provider-session-artifact'); p.add_argument('--process-identity',type=_json_value,required=True); p.add_argument('--launch-identity',type=_json_value,required=True); _policy_arg(p)
    p=sub.add_parser('continuity-plan'); p.add_argument('--run-id',required=True); p.add_argument('--live-process-evidence'); p.add_argument('--native-session-evidence'); p.add_argument('--checkpoint'); p.add_argument('--fallback-approval'); _policy_arg(p)
    p=sub.add_parser('continuity-complete'); p.add_argument('--run-id',required=True); p.add_argument('--path',choices=('LIVE_PROCESS_REATTACH','NATIVE_PROVIDER_SESSION_RESUME'),required=True); p.add_argument('--delivery-id',required=True); p.add_argument('--recovery-facts',type=_json_value,required=True); _policy_arg(p)
    p=sub.add_parser('checkpoint-fallback'); p.add_argument('--run-id',required=True); p.add_argument('--checkpoint',required=True); p.add_argument('--approval',required=True); p.add_argument('--reason',required=True); _policy_arg(p)

    for name in ('usage-codex','usage-claude'):
        p=sub.add_parser(name); p.add_argument('--artifact',required=True); p.add_argument('--run-id'); p.add_argument('--task-id'); p.add_argument('--role',required=True); p.add_argument('--terminal-id'); p.add_argument('--expected-session-id'); p.add_argument('--append',action='store_true'); _policy_arg(p)
    p=sub.add_parser('usage-correlate'); p.add_argument('--registry',required=True); p.add_argument('--role',required=True); p.add_argument('--run-id'); p.add_argument('--task-id'); p.add_argument('--terminal-id'); p.add_argument('--append',action='store_true'); _policy_arg(p)
    p=sub.add_parser('usage-agy-unavailable'); p.add_argument('--run-id'); p.add_argument('--task-id'); p.add_argument('--role',required=True); p.add_argument('--job-id',required=True); p.add_argument('--model',required=True); p.add_argument('--prompt-bytes',type=int,required=True); p.add_argument('--elapsed-seconds',type=float); p.add_argument('--append',action='store_true'); _policy_arg(p)

    p=sub.add_parser('active-runs'); _policy_arg(p)
    p=sub.add_parser('herdr-preflight'); p.add_argument('--session-name'); p.add_argument('--output'); _policy_arg(p)
    p=sub.add_parser('active-resources'); _policy_arg(p)
    p=sub.add_parser('safe-restart'); p.add_argument('--scope',choices=('controller','control_plane','full_runtime'),default='controller'); p.add_argument('--apply',action='store_true'); p.add_argument('--force',action='store_true'); p.add_argument('--approval-file'); _policy_arg(p)

    p=sub.add_parser('canary-open',help='open a bounded disposable canary scope authorizing real provider dispatch for named run_ids'); p.add_argument('--scope-id',required=True); p.add_argument('--run-ids',type=_json_list,required=True); p.add_argument('--ttl-seconds',type=int,default=1800); p.add_argument('--reason',required=True); p.add_argument('--opened-by',required=True); _policy_arg(p)
    p=sub.add_parser('canary-close',help='restore safe v2_shadow posture'); p.add_argument('--reason',default='canary complete'); _policy_arg(p)
    p=sub.add_parser('canary-status'); _policy_arg(p)
    p=sub.add_parser('validate-packet'); p.add_argument('--kind',choices=('charter','phase','routing','result','capacity'),required=True); p.add_argument('--file',required=True); p.add_argument('--charter'); p.add_argument('--phase'); _policy_arg(p)

    p=sub.add_parser('skill-cache-plan'); p.add_argument('--lock',default=None)
    p=sub.add_parser('skill-cache-populate'); p.add_argument('--lock',default=None); p.add_argument('--cache-root',required=True); p.add_argument('--project'); p.add_argument('--security-domain')
    p=sub.add_parser('skill-cache-verify-mirror'); p.add_argument('--lock',default=None); p.add_argument('--cache-root',required=True); p.add_argument('--mirror-root',default='~/.agents/skills'); p.add_argument('--project',required=True); p.add_argument('--security-domain',required=True)
    p=sub.add_parser('skill-cache-project-mirror',help='project already-sealed, already-approved bundle bytes into the native ~/.agents/skills mirror'); p.add_argument('--lock',default=None); p.add_argument('--cache-root',required=True); p.add_argument('--mirror-root',default='~/.agents/skills'); p.add_argument('--project',required=True); p.add_argument('--security-domain',required=True); p.add_argument('--rollback-root',required=True)
    return ap


def main(argv: list[str]|None=None) -> int:
    parser=build_parser(); args=parser.parse_args(argv)
    try:
        c=args.command
        if c=='init-run':
            policy=load_policy(args.policy); cfg=policy.get('supervisor_profiles',{}).get(args.supervisor_profile)
            if not cfg: raise MLGOError(f'unapproved authoritative supervisor profile: {args.supervisor_profile}')
            out=RunStore(policy['state_root'],args.run_id).initialize(mode=args.mode,supervisor_profile=args.supervisor_profile,supervisor_account_pool=cfg['account_pool'])
        elif c=='show-state': policy=load_policy(args.policy); out=RunStore(policy['state_root'],args.run_id).load()
        elif c=='registry-info':
            policy=load_policy(args.policy); reg=load_registry(args.registry or resolve_registry_path(policy_path=policy['_source_path'])); out={'registry_version':reg['registry_version'],'registry_digest':reg['_registry_digest'],'source_sha256':reg['_source_sha256'],'profiles':sorted(reg['profiles']),'routes':compatibility_policy_routes(reg)}
        elif c=='repair-state': policy=load_policy(args.policy); out=RunStore(policy['state_root'],args.run_id).repair()
        elif c=='set-run-status': policy=load_policy(args.policy); out=RunStore(policy['state_root'],args.run_id).set_run_status(args.status,reason=args.reason)
        elif c=='register-charter':
            policy=load_policy(args.policy); charter=load_and_validate(args.charter,'charter',policy)
            if charter['run_id']!=args.run_id: raise MLGOError('charter run_id mismatch')
            out=RunStore(policy['state_root'],args.run_id).register_big_task(charter['big_task_id'],str(Path(args.charter).resolve()),args.task_lead_id)
        elif c=='transition-phase': policy=load_policy(args.policy); out=RunStore(policy['state_root'],args.run_id).transition_phase(args.phase_id,args.target,expected_state_version=args.expected_version,reason=args.reason)
        elif c=='capacity': policy=load_policy(args.policy); out=create_snapshot(policy,run_id=args.run_id,supervisor_profile=args.supervisor_profile,gateway_authorized=args.gateway_authorized,output_path=args.output)
        elif c=='capacity-hint': policy=load_policy(args.policy); out=set_manual_hint(policy,account_pool=args.account_pool,capacity_band=args.band,ttl_seconds=args.ttl_seconds,reason=args.reason,operator_identity=args.operator_identity)
        elif c=='route':
            policy=load_policy(args.policy); charter=load_and_validate(args.charter,'charter',policy); proposal=load_and_validate(args.proposal,'routing',policy,charter=charter); snap=load_and_validate(args.snapshot,'capacity',policy); out=decide_route(proposal,charter,snap,policy); _write_optional(args.output,out)
        elif c=='submit-phase': out=submit_phase(phase_path=args.phase,policy_path=args.policy,shadow=args.shadow)
        elif c=='canary-open': policy=load_policy(args.policy); out=open_scope(policy,scope_id=args.scope_id,run_ids=args.run_ids,ttl_seconds=args.ttl_seconds,reason=args.reason,opened_by=args.opened_by)
        elif c=='canary-close': policy=load_policy(args.policy); out=close_scope(policy,reason=args.reason)
        elif c=='canary-status': policy=load_policy(args.policy); out=canary_status(policy)
        elif c=='run-job': out=run_job(args.job_file,args.policy)
        elif c=='qualify-provider':
            policy=load_policy(args.policy,registry_path=args.registry)
            out=qualify_child_transport_provider(policy=policy,provider=args.provider,selected_profile=args.profile,registry=policy['_registry'],evidence_path=Path(args.evidence),launch_argv_path=Path(args.launch_argv) if args.launch_argv else None)
        elif c=='controller-once': out=process_run_once(args.run_id,args.policy)
        elif c=='controller-event': out=process_event(args.event,args.policy)
        elif c=='controller-serve': run_forever(args.policy,args.interval); return 0
        elif c=='start-task-lead': out=start_task_lead(run_id=args.run_id,big_task_id=args.big_task_id,task_lead_id=args.task_lead_id,charter_path=args.charter,profile=args.profile,main_session=args.main_session,supervisor_terminal_id=args.supervisor_terminal_id,policy_path=args.policy,recovery_checkpoint=args.recovery_checkpoint,gateway_authorized=args.gateway_authorized)
        elif c=='notify-supervisor': out=notify_supervisor(run_id=args.run_id,big_task_id=args.big_task_id,packet_path=args.packet,supervisor_terminal_id=args.supervisor_terminal_id,policy_path=args.policy)
        elif c=='git-commit': out=commit_task(worktree=args.worktree,expected_branch=args.branch,allowed_paths=args.allowed_paths,forbidden_paths=args.forbidden_paths,message=args.message,operation_id=args.operation_id); _write_optional(args.output,out)
        elif c=='git-integrate': out=integrate_commit(integration_worktree=args.worktree,expected_branch=args.branch,commit_sha=args.commit); _write_optional(args.output,out)
        elif c=='git-push': out=push_branch(worktree=args.worktree,remote=args.remote,branch=args.branch,expected_sha=args.sha); _write_optional(args.output,out)
        elif c=='git-pr': out=create_pull_request(repository=args.repository,head_branch=args.head,base_branch=args.base,title=args.title,body_file=args.body_file); _write_optional(args.output,out)
        elif c=='git-reachability': out=verify_reachability(repository=args.repository,remote=args.remote,branch=args.branch,expected_sha=args.sha); _write_optional(args.output,out)
        elif c=='git-ci':
            if not isinstance(args.required_checks,list): raise MLGOError('--required-checks must be a JSON array')
            out=verify_ci(repository=args.repository,sha=args.sha,required_checks=args.required_checks,timeout_seconds=args.timeout_seconds); _write_optional(args.output,out)
        elif c=='prepare-final-facts': out=prepare_final_facts(run_id=args.run_id,integration_worktree=args.integration_worktree,target_branch=args.target_branch,expected_sha=args.expected_sha,review_record=args.review_record,final_validation_record=args.final_validation_record,publication_authorization=args.publication_authorization,publication_record=args.publication_record,remote_ci_record=args.remote_ci_record,required_ci_checks=args.required_ci_checks,publication_required=not args.publication_not_required,ci_required=not args.ci_not_required,remote=args.remote,policy_path=args.policy)
        elif c=='finalize': out=finalize_with_verdict(run_id=args.run_id,final_facts_record=args.final_facts_record,final_verdict=args.final_verdict,policy_path=args.policy)
        elif c=='delivery-create':
            policy=load_policy(args.policy); store=RunStore(policy['state_root'],args.run_id); payload=Path(args.payload_file).read_text(); out=create_delivery(store=store,recipient_role=args.recipient_role,terminal_id=args.terminal_id,profile=args.profile,generation=args.generation,provider=args.provider,provider_session_id=args.provider_session_id,payload=payload,delivery_id=args.delivery_id)
        elif c=='delivery-observe':
            policy=load_policy(args.policy); store=RunStore(policy['state_root'],args.run_id)
            ack=parse_model_artifact_observation(store=store,observation_source=args.source,artifact_path=args.artifact,record_index=args.ack_record_index)
            response=parse_model_artifact_observation(store=store,observation_source=args.source,artifact_path=args.artifact,record_index=args.response_record_index) if args.response_record_index else None
            out=record_model_observation(store=store,delivery_id=args.delivery_id,ack_observation=ack,response_observation=response)
        elif c=='delivery-observe-manual':
            policy=load_policy(args.policy); store=RunStore(policy['state_root'],args.run_id)
            out=record_manual_observation(store=store,delivery_id=args.delivery_id,observed_text=Path(args.observed_text_file).read_text(),response_text=Path(args.response_text_file).read_text() if args.response_text_file else None,source_note=args.source_note)
        elif c=='capture-supervisor-decision': policy=load_policy(args.policy); out=capture_supervisor_decision(store=RunStore(policy['state_root'],args.run_id),decision_packet=load_json(args.decision_packet),delivery_id=args.delivery_id)
        elif c=='continuity-register': policy=load_policy(args.policy); out=register_session(store=RunStore(policy['state_root'],args.run_id),profile=args.profile,generation=args.generation,terminal_id=args.terminal_id,provider=args.provider,provider_session_id=args.provider_session_id,provider_session_artifact=args.provider_session_artifact,process_identity=args.process_identity,launch_identity=args.launch_identity)
        elif c=='continuity-plan':
            policy=load_policy(args.policy); store=RunStore(policy['state_root'],args.run_id); out=plan_recovery(store=store,policy=policy,live_process_evidence=load_json(args.live_process_evidence) if args.live_process_evidence else None,native_session_evidence=load_json(args.native_session_evidence) if args.native_session_evidence else None,checkpoint_path=args.checkpoint,fallback_approval=load_json(args.fallback_approval) if args.fallback_approval else None)
        elif c=='continuity-complete': policy=load_policy(args.policy); out=complete_same_session_recovery(store=RunStore(policy['state_root'],args.run_id),policy=policy,path=args.path,delivery_id=args.delivery_id,recovery_facts=args.recovery_facts)
        elif c=='checkpoint-fallback': policy=load_policy(args.policy); out=begin_checkpoint_fallback(store=RunStore(policy['state_root'],args.run_id),policy=policy,checkpoint_path=args.checkpoint,approval=load_json(args.approval),reason=args.reason)
        elif c in {'usage-codex','usage-claude','usage-agy-unavailable','usage-correlate'}:
            policy=load_policy(args.policy)
            if c=='usage-codex': events=codex_rollout_events(rollout_path=args.artifact,run_id=args.run_id,task_id=args.task_id,role=args.role,terminal_id=args.terminal_id,expected_session_id=args.expected_session_id); out={'events':events,'count':len(events),'status':'EXACT' if events and all(x['exact_correlation'] for x in events) else 'WARNING_ONLY'}
            elif c=='usage-claude': events=claude_transcript_events(transcript_path=args.artifact,run_id=args.run_id,task_id=args.task_id,role=args.role,terminal_id=args.terminal_id,expected_session_id=args.expected_session_id); out={'events':events,'count':len(events),'status':'EXACT' if events and all(x['exact_correlation'] for x in events) else 'WARNING_ONLY'}
            elif c=='usage-correlate': out=correlate_registry_usage(registry_path=args.registry,role=args.role,run_id=args.run_id,task_id=args.task_id,terminal_id=args.terminal_id); events=out['events']; out['enforcement_mode']=enforce_usage_mode(policy,out)
            else: events=[agy_usage_placeholder(run_id=args.run_id,task_id=args.task_id,role=args.role,job_id=args.job_id,model=args.model,prompt_bytes=args.prompt_bytes,elapsed_seconds=args.elapsed_seconds)]; out={'events':events,'count':1,'status':'UNAVAILABLE'}
            if args.append:
                for event in events: append_usage_event(policy['state_root'],event)
            out['appended']=bool(args.append)
        elif c=='active-runs': out=active_runs(load_policy(args.policy))
        elif c=='herdr-preflight':
            policy=load_policy(args.policy); out=preflight_herdr_boundary(policy,session_name=args.session_name); _write_optional(args.output,out)
        elif c=='active-resources': out=active_resources(load_policy(args.policy))
        elif c=='safe-restart': out=guarded_restart(policy_path=args.policy,force=args.force,approval_file=args.approval_file,scope=args.scope,apply=args.apply)
        elif c=='validate-packet': policy=load_policy(args.policy); out=load_and_validate(args.file,args.kind,policy,charter=load_json(args.charter) if args.charter else None,phase=load_json(args.phase) if args.phase else None)
        elif c=='skill-cache-plan':
            lock=load_lock(args.lock)
            out={'lock_digest':lock['lock_digest'],'requires_semantic_choice_at_staging_time':False,'acquisitions':population_plan(lock)}
        elif c=='skill-cache-populate':
            lock=load_lock(args.lock); cache=SealedSkillCache(args.cache_root)
            out=populate_cache(cache=cache,lock=lock)
            if args.project and args.security_domain: out['bindings']=bind_namespace(cache=cache,lock=lock,project_id=args.project,security_domain_id=args.security_domain)
        elif c=='skill-cache-verify-mirror':
            lock=load_lock(args.lock); cache=SealedSkillCache(args.cache_root)
            out=verify_native_mirror(cache=cache,lock=lock,mirror_root=args.mirror_root,project_id=args.project,security_domain_id=args.security_domain)
            _print(out); return 0 if out['accepted'] else 1
        elif c=='skill-cache-project-mirror':
            lock=load_lock(args.lock); cache=SealedSkillCache(args.cache_root)
            out=project_native_mirror(cache=cache,lock=lock,mirror_root=args.mirror_root,project_id=args.project,security_domain_id=args.security_domain,rollback_root=args.rollback_root)
        else: parser.error(f'unhandled command: {c}'); return 2
        _print(out); return 0
    except (MLGOError,OSError,ValueError,json.JSONDecodeError) as exc:
        print(json.dumps({'ok':False,'error':str(exc),'type':type(exc).__name__,'at':iso_now()},sort_keys=True),file=sys.stderr); return 1

if __name__=='__main__': raise SystemExit(main())
