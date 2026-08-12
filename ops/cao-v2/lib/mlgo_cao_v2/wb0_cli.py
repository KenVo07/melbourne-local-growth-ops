"""Command line for WB-0 golden capture, verification, and recovery."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .wb0_bootstrap import build_bootstrap_bundle, verify_bootstrap_bundle
from .wb0_capsule import capture_golden_capsule, load_capture_spec
from .wb0_common import WB0Error, atomic_write_json, iso_now, load_json_object
from .wb0_instance import load_instance, new_instance, validate_instance
from .wb0_manifest import (
    create_deterministic_tar_gz,
    safe_extract_tar_gz,
    verify_release_capsule,
)
from .wb0_recovery import (
    STEPS,
    apply_recovery,
    build_recovery_plan,
    inspect_recovery_transaction,
    start_controller_after_recovery,
    validate_resource_report,
)
from .wb0_state import verify_generation


def _print(value: Any) -> None:
    print(json.dumps(value, indent=2, sort_keys=True))


def _load_optional(path: str | None) -> dict[str, Any] | None:
    return load_json_object(path) if path else None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mlgo-v2-wb0",
        description="WB-0 immutable golden release, state generation, and recovery tooling",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("instance-new")
    p.add_argument("--instance-id", required=True)
    p.add_argument("--config-root", required=True)
    p.add_argument("--state-root", required=True)
    p.add_argument("--release-root", required=True)
    p.add_argument("--project-root", action="append", required=True)
    p.add_argument("--worktree-command", required=True)
    p.add_argument("--systemctl-command", default="/usr/bin/systemctl")
    p.add_argument("--systemd-run-command", default="/usr/bin/systemd-run")
    p.add_argument("--bin-root")
    p.add_argument("--systemd-user-unit-root")
    p.add_argument("--skill-cache-root")
    p.add_argument("--native-skill-mirror-root")
    p.add_argument("--skill-project-id")
    p.add_argument("--security-domain-id")
    p.add_argument("--output", required=True)

    p = sub.add_parser("instance-verify")
    p.add_argument("--instance", required=True)
    p.add_argument("--check-existing-ancestors", action="store_true")

    p = sub.add_parser("bootstrap-build")
    p.add_argument("--source-cao-root", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--apply", action="store_true")

    p = sub.add_parser("bootstrap-verify")
    p.add_argument("--bootstrap", required=True)

    p = sub.add_parser("capture")
    p.add_argument("--spec", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--apply", action="store_true", help="required: capture writes a new capsule")

    p = sub.add_parser("capsule-verify")
    p.add_argument("--capsule", required=True)

    p = sub.add_parser("capsule-archive")
    p.add_argument("--capsule", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--apply", action="store_true")

    p = sub.add_parser("capsule-extract")
    p.add_argument("--archive", required=True)
    p.add_argument("--destination", required=True)
    p.add_argument("--apply", action="store_true")

    p = sub.add_parser("resource-report-wrap")
    p.add_argument("--active-resources", required=True)
    p.add_argument("--output")

    for name in ("recovery-plan", "recovery-apply"):
        p = sub.add_parser(name)
        p.add_argument("--instance", required=True)
        p.add_argument("--capsule", required=True)
        p.add_argument("--mode", choices=("same_host", "fresh_host"), required=True)
        p.add_argument("--resource-report")
        p.add_argument("--golden-generation-id", required=True)
        p.add_argument("--writable-generation-id", required=True)
        p.add_argument("--config-generation-id", required=True)
        p.add_argument("--state-schema-version", default="2.1")
        if name == "recovery-apply":
            p.add_argument("--transaction-id", required=True)
            p.add_argument("--fault-after", choices=STEPS, help=argparse.SUPPRESS)
            p.add_argument("--apply", action="store_true")


    p = sub.add_parser("controller-start")
    p.add_argument("--instance", required=True)
    p.add_argument("--transaction-id", required=True)
    p.add_argument("--start-id", required=True)
    p.add_argument("--apply", action="store_true")

    p = sub.add_parser("transaction-show")
    p.add_argument("--instance", required=True)
    p.add_argument("--transaction-id", required=True)

    p = sub.add_parser("state-verify")
    p.add_argument("--state-root", required=True)
    p.add_argument("--generation-id", required=True)
    p.add_argument("--release-id")
    p.add_argument("--immutable", choices=("true", "false"))
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        command = args.command
        if command == "instance-new":
            instance = new_instance(
                instance_id=args.instance_id,
                config_root=args.config_root,
                state_root=args.state_root,
                release_root=args.release_root,
                project_roots=args.project_root,
                worktree_command=args.worktree_command,
                systemctl_command=args.systemctl_command,
                systemd_run_command=args.systemd_run_command,
                bin_root=args.bin_root,
                systemd_user_unit_root=args.systemd_user_unit_root,
                skill_cache_root=args.skill_cache_root,
                native_mirror_root=args.native_skill_mirror_root,
                skill_project_id=args.skill_project_id,
                security_domain_id=args.security_domain_id,
            )
            atomic_write_json(Path(args.output), instance, mode=0o600)
            result = {"instance": instance, "output": str(Path(args.output).resolve())}
        elif command == "instance-verify":
            result = load_instance(
                args.instance,
                check_existing_ancestors=args.check_existing_ancestors,
            )
        elif command == "bootstrap-build":
            if not args.apply:
                parser.error("bootstrap-build requires --apply")
            result = build_bootstrap_bundle(
                source_cao_root=args.source_cao_root, output_directory=args.output
            )
        elif command == "bootstrap-verify":
            result = verify_bootstrap_bundle(args.bootstrap)
        elif command == "capture":
            if not args.apply:
                parser.error("capture requires --apply; use capsule-verify for read-only inspection")
            result = capture_golden_capsule(
                spec=load_capture_spec(args.spec), output_directory=args.output
            )
        elif command == "capsule-verify":
            result = verify_release_capsule(args.capsule)
        elif command == "capsule-archive":
            if not args.apply:
                parser.error("capsule-archive requires --apply")
            output = create_deterministic_tar_gz(args.capsule, args.output)
            result = {"archive": str(output), "capsule": str(Path(args.capsule).resolve())}
        elif command == "capsule-extract":
            if not args.apply:
                parser.error("capsule-extract requires --apply")
            result = {
                "capsule": str(safe_extract_tar_gz(args.archive, args.destination))
            }
        elif command == "resource-report-wrap":
            resources = load_json_object(args.active_resources)
            report = {
                "schema_version": "1.0",
                "captured_at": iso_now(),
                "active_resources": resources,
            }
            validate_resource_report(report)
            if args.output:
                atomic_write_json(Path(args.output), report, mode=0o600)
            result = report
        elif command == "recovery-plan":
            instance = load_instance(args.instance)
            report = _load_optional(args.resource_report)
            result = build_recovery_plan(
                instance=instance,
                capsule_root=args.capsule,
                mode=args.mode,
                golden_generation_id=args.golden_generation_id,
                writable_generation_id=args.writable_generation_id,
                config_generation_id=args.config_generation_id,
                state_schema_version=args.state_schema_version,
                resource_report=report,
            )
        elif command == "recovery-apply":
            if not args.apply:
                parser.error("recovery-apply requires --apply; run recovery-plan first")
            instance = load_instance(args.instance)
            result = apply_recovery(
                instance=instance,
                capsule_root=args.capsule,
                transaction_id=args.transaction_id,
                mode=args.mode,
                golden_generation_id=args.golden_generation_id,
                writable_generation_id=args.writable_generation_id,
                config_generation_id=args.config_generation_id,
                state_schema_version=args.state_schema_version,
                resource_report=_load_optional(args.resource_report),
                fault_after=args.fault_after,
            )
        elif command == "controller-start":
            if not args.apply:
                parser.error("controller-start requires --apply")
            result = start_controller_after_recovery(
                instance=load_instance(args.instance),
                transaction_id=args.transaction_id,
                start_id=args.start_id,
            )
        elif command == "transaction-show":
            result = inspect_recovery_transaction(
                instance=load_instance(args.instance),
                transaction_id=args.transaction_id,
            )
        elif command == "state-verify":
            require = None if args.immutable is None else args.immutable == "true"
            result = verify_generation(
                args.state_root,
                args.generation_id,
                release_id=args.release_id,
                require_immutable=require,
            )
        else:  # pragma: no cover - argparse prevents this
            parser.error(f"unknown command: {command}")
        _print(result)
        return 0
    except WB0Error as exc:
        print(f"WB0 ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
