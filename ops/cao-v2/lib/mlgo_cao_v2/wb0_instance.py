"""WB-0 instance identity and portable root bindings."""
from __future__ import annotations

import copy
import shlex
from pathlib import Path
from typing import Any

from .wb0_common import (
    WB0ContractError,
    WB0SafetyError,
    ensure_no_symlink_ancestors,
    lexical_absolute_path,
    load_json_object,
    paths_overlap,
    sha256_json,
    validate_id,
)

INSTANCE_SCHEMA_VERSION = "1.0"
_TOP_KEYS = {
    "schema_version",
    "instance_id",
    "roots",
    "project_roots",
    "provider_bindings",
    "skill_bindings",
    "policy_bindings",
    "host_adapter",
    "instance_digest",
}
_ROOT_KEYS = {"config_root", "state_root", "release_root"}
_PROVIDER_KEYS = {"qualification_root", "profiles"}
_SKILL_KEYS = {"cache_root", "native_mirror_root", "project_id", "security_domain_id"}
_POLICY_KEYS = {"policy_path", "budget_policy_refs"}
_HOST_KEYS = {
    "worktree_command",
    "dispatch_command",
    "systemctl_command",
    "systemd_run_command",
    "controller_unit",
    "bin_root",
    "systemd_user_unit_root",
}
_FORBIDDEN_KEY_FRAGMENTS = {
    "api_key",
    "access_token",
    "refresh_token",
    "password",
    "private_key",
    "client_secret",
    "cookie",
    "credential",
    "oauth",
}


def _reject_unknown(value: dict[str, Any], allowed: set[str], label: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise WB0ContractError(f"{label} has unsupported fields: {unknown}")


def _reject_secret_keys(value: Any, path: str = "instance") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).lower().replace("-", "_")
            if any(fragment in normalized for fragment in _FORBIDDEN_KEY_FRAGMENTS):
                raise WB0SafetyError(
                    f"host-local secret/auth material is forbidden in instance config: {path}.{key}"
                )
            _reject_secret_keys(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_secret_keys(child, f"{path}[{index}]")


def _absolute_command(raw: object, label: str) -> str:
    return str(lexical_absolute_path(raw, label))


def validate_instance(
    value: dict[str, Any], *, check_existing_ancestors: bool = False
) -> dict[str, Any]:
    """Validate and normalize one non-secret instance document.

    The three control roots must be disjoint.  Project roots must also remain
    outside them so recovery can never recursively copy or overwrite a project.
    """
    if not isinstance(value, dict):
        raise WB0ContractError("instance config must be a JSON object")
    _reject_unknown(value, _TOP_KEYS, "instance")
    _reject_secret_keys(value)
    if value.get("schema_version") != INSTANCE_SCHEMA_VERSION:
        raise WB0ContractError(
            f"unsupported instance schema: {value.get('schema_version')!r}"
        )
    instance_id = validate_id(value.get("instance_id"), "instance_id")

    roots = value.get("roots")
    if not isinstance(roots, dict):
        raise WB0ContractError("instance.roots must be an object")
    _reject_unknown(roots, _ROOT_KEYS, "instance.roots")
    if set(roots) != _ROOT_KEYS:
        raise WB0ContractError(f"instance.roots requires exactly {sorted(_ROOT_KEYS)}")
    normalized_roots = {
        key: lexical_absolute_path(roots[key], f"roots.{key}") for key in sorted(_ROOT_KEYS)
    }
    root_items = list(normalized_roots.items())
    for index, (name_a, path_a) in enumerate(root_items):
        for name_b, path_b in root_items[index + 1 :]:
            if paths_overlap(path_a, path_b):
                raise WB0SafetyError(
                    f"instance roots must be disjoint: {name_a}={path_a} overlaps {name_b}={path_b}"
                )
    if check_existing_ancestors:
        for path in normalized_roots.values():
            ensure_no_symlink_ancestors(path)

    raw_projects = value.get("project_roots")
    if not isinstance(raw_projects, list) or not raw_projects:
        raise WB0ContractError("project_roots must be a non-empty array")
    project_roots: list[Path] = []
    for index, raw in enumerate(raw_projects):
        path = lexical_absolute_path(raw, f"project_roots[{index}]")
        if any(paths_overlap(path, control) for control in normalized_roots.values()):
            raise WB0SafetyError(
                f"project root overlaps an instance control root: {path}"
            )
        if any(paths_overlap(path, prior) for prior in project_roots):
            raise WB0SafetyError(f"project roots overlap: {path}")
        if check_existing_ancestors:
            ensure_no_symlink_ancestors(path)
        project_roots.append(path)

    provider = value.get("provider_bindings")
    if not isinstance(provider, dict):
        raise WB0ContractError("provider_bindings must be an object")
    _reject_unknown(provider, _PROVIDER_KEYS, "provider_bindings")
    qualification_root = lexical_absolute_path(
        provider.get("qualification_root"), "provider_bindings.qualification_root"
    )
    state_root = normalized_roots["state_root"]
    try:
        qualification_root.relative_to(state_root)
    except ValueError as exc:
        raise WB0SafetyError("provider qualification_root must live below state_root") from exc
    profiles = provider.get("profiles")
    if not isinstance(profiles, dict):
        raise WB0ContractError("provider_bindings.profiles must be an object")
    normalized_profiles: dict[str, dict[str, Any]] = {}
    for profile_id, binding in sorted(profiles.items()):
        validate_id(profile_id, "provider profile id")
        if not isinstance(binding, dict):
            raise WB0ContractError(f"provider binding {profile_id!r} must be an object")
        _reject_unknown(
            binding,
            {"account_binding_id", "qualification_required"},
            f"provider_bindings.profiles.{profile_id}",
        )
        account_binding_id = validate_id(
            binding.get("account_binding_id"), "account_binding_id"
        )
        qualification_required = binding.get("qualification_required")
        if qualification_required is not True:
            raise WB0SafetyError(
                f"fresh-host provider binding {profile_id!r} must require host-local qualification"
            )
        normalized_profiles[profile_id] = {
            "account_binding_id": account_binding_id,
            "qualification_required": True,
        }

    skill = value.get("skill_bindings")
    if not isinstance(skill, dict):
        raise WB0ContractError("skill_bindings must be an object")
    _reject_unknown(skill, _SKILL_KEYS, "skill_bindings")
    if set(skill) != _SKILL_KEYS:
        raise WB0ContractError(f"skill_bindings requires exactly {sorted(_SKILL_KEYS)}")
    skill_cache_root = lexical_absolute_path(
        skill.get("cache_root"), "skill_bindings.cache_root"
    )
    try:
        skill_cache_root.relative_to(state_root)
    except ValueError as exc:
        raise WB0SafetyError("skill cache_root must live below state_root") from exc
    native_mirror_root = lexical_absolute_path(
        skill.get("native_mirror_root"), "skill_bindings.native_mirror_root"
    )
    skill_project_id = validate_id(skill.get("project_id"), "skill project_id")
    security_domain_id = validate_id(
        skill.get("security_domain_id"), "skill security_domain_id"
    )
    for project_root in project_roots:
        if paths_overlap(native_mirror_root, project_root):
            raise WB0SafetyError(
                f"native skill mirror overlaps a project root: {native_mirror_root}"
            )
    for control_name, control_root in normalized_roots.items():
        if paths_overlap(native_mirror_root, control_root):
            raise WB0SafetyError(
                f"native skill mirror overlaps {control_name}: {native_mirror_root}"
            )
    if check_existing_ancestors:
        ensure_no_symlink_ancestors(skill_cache_root)
        ensure_no_symlink_ancestors(native_mirror_root)

    policy = value.get("policy_bindings")
    if not isinstance(policy, dict):
        raise WB0ContractError("policy_bindings must be an object")
    _reject_unknown(policy, _POLICY_KEYS, "policy_bindings")
    policy_path = lexical_absolute_path(
        policy.get("policy_path"), "policy_bindings.policy_path"
    )
    config_root = normalized_roots["config_root"]
    try:
        policy_path.relative_to(config_root)
    except ValueError as exc:
        raise WB0SafetyError("policy_path must live below config_root") from exc
    budget_refs = policy.get("budget_policy_refs")
    if not isinstance(budget_refs, list):
        raise WB0ContractError("budget_policy_refs must be an array")
    normalized_budget_refs: list[str] = []
    for index, raw in enumerate(budget_refs):
        path = lexical_absolute_path(raw, f"budget_policy_refs[{index}]")
        if not any(path == root or path.is_relative_to(root) for root in project_roots + [config_root]):
            raise WB0SafetyError(
                f"budget policy reference must be under config_root or a project root: {path}"
            )
        normalized_budget_refs.append(str(path))

    host = value.get("host_adapter")
    if not isinstance(host, dict):
        raise WB0ContractError("host_adapter must be an object")
    _reject_unknown(host, _HOST_KEYS, "host_adapter")
    controller_unit = host.get("controller_unit")
    if controller_unit != "mlgo-cao-v2-controller.service":
        raise WB0SafetyError(
            "WB-0 recovery may manage only mlgo-cao-v2-controller.service"
        )
    normalized_host = {
        "worktree_command": _absolute_command(
            host.get("worktree_command"), "host_adapter.worktree_command"
        ),
        "dispatch_command": _absolute_command(
            host.get("dispatch_command"), "host_adapter.dispatch_command"
        ),
        "systemctl_command": _absolute_command(
            host.get("systemctl_command"), "host_adapter.systemctl_command"
        ),
        "systemd_run_command": _absolute_command(
            host.get("systemd_run_command"), "host_adapter.systemd_run_command"
        ),
        "controller_unit": controller_unit,
        "bin_root": str(lexical_absolute_path(host.get("bin_root"), "host_adapter.bin_root")),
        "systemd_user_unit_root": str(lexical_absolute_path(host.get("systemd_user_unit_root"), "host_adapter.systemd_user_unit_root")),
    }
    projection_roots = {
        "bin_root": Path(normalized_host["bin_root"]),
        "systemd_user_unit_root": Path(normalized_host["systemd_user_unit_root"]),
        "native_mirror_root": native_mirror_root,
    }
    for projection_name, projection_root in projection_roots.items():
        for project_root in project_roots:
            if paths_overlap(projection_root, project_root):
                raise WB0SafetyError(
                    f"host projection root {projection_name} overlaps project root: {projection_root}"
                )
        for control_name, control_root in normalized_roots.items():
            if paths_overlap(projection_root, control_root):
                raise WB0SafetyError(
                    f"host projection root {projection_name} overlaps {control_name}: {projection_root}"
                )
    projection_items = list(projection_roots.items())
    for index, (name_a, path_a) in enumerate(projection_items):
        for name_b, path_b in projection_items[index + 1 :]:
            if paths_overlap(path_a, path_b):
                raise WB0SafetyError(
                    f"host projection roots must be disjoint: {name_a}={path_a} overlaps {name_b}={path_b}"
                )
    if check_existing_ancestors:
        for projection_root in projection_roots.values():
            ensure_no_symlink_ancestors(projection_root)

    normalized: dict[str, Any] = {
        "schema_version": INSTANCE_SCHEMA_VERSION,
        "instance_id": instance_id,
        "roots": {key: str(path) for key, path in normalized_roots.items()},
        "project_roots": [str(path) for path in project_roots],
        "provider_bindings": {
            "qualification_root": str(qualification_root),
            "profiles": normalized_profiles,
        },
        "skill_bindings": {
            "cache_root": str(skill_cache_root),
            "native_mirror_root": str(native_mirror_root),
            "project_id": skill_project_id,
            "security_domain_id": security_domain_id,
        },
        "policy_bindings": {
            "policy_path": str(policy_path),
            "budget_policy_refs": normalized_budget_refs,
        },
        "host_adapter": normalized_host,
    }
    expected_digest = sha256_json(normalized)
    declared_digest = value.get("instance_digest")
    if declared_digest is not None and declared_digest != expected_digest:
        raise WB0ContractError(
            "instance_digest mismatch: instance config was changed after sealing"
        )
    normalized["instance_digest"] = expected_digest
    return normalized


def load_instance(path: str | Path, *, check_existing_ancestors: bool = False) -> dict[str, Any]:
    return validate_instance(
        load_json_object(path), check_existing_ancestors=check_existing_ancestors
    )


def new_instance(
    *,
    instance_id: str,
    config_root: str | Path,
    state_root: str | Path,
    release_root: str | Path,
    project_roots: list[str | Path],
    worktree_command: str | Path,
    provider_profiles: dict[str, str] | None = None,
    systemctl_command: str | Path = "/usr/bin/systemctl",
    systemd_run_command: str | Path = "/usr/bin/systemd-run",
    bin_root: str | Path | None = None,
    systemd_user_unit_root: str | Path | None = None,
    skill_cache_root: str | Path | None = None,
    native_mirror_root: str | Path | None = None,
    skill_project_id: str | None = None,
    security_domain_id: str | None = None,
) -> dict[str, Any]:
    config = Path(config_root).expanduser().absolute()
    state = Path(state_root).expanduser().absolute()
    raw = {
        "schema_version": INSTANCE_SCHEMA_VERSION,
        "instance_id": instance_id,
        "roots": {
            "config_root": str(config),
            "state_root": str(state),
            "release_root": str(Path(release_root).expanduser().absolute()),
        },
        "project_roots": [str(Path(p).expanduser().absolute()) for p in project_roots],
        "provider_bindings": {
            "qualification_root": str(state / "host-qualification"),
            "profiles": {
                profile_id: {
                    "account_binding_id": account_binding_id,
                    "qualification_required": True,
                }
                for profile_id, account_binding_id in sorted((provider_profiles or {}).items())
            },
        },
        "skill_bindings": {
            "cache_root": str(Path(skill_cache_root).expanduser().absolute() if skill_cache_root is not None else state / "skill-assets"),
            "native_mirror_root": str(Path(native_mirror_root).expanduser().absolute() if native_mirror_root is not None else Path.home() / ".agents" / "skills"),
            "project_id": skill_project_id or instance_id,
            "security_domain_id": security_domain_id or f"{instance_id}-default",
        },
        "policy_bindings": {
            "policy_path": str(config / "current" / "payload" / "cao-policy.json"),
            "budget_policy_refs": [],
        },
        "host_adapter": {
            "worktree_command": str(Path(worktree_command).expanduser().absolute()),
            "dispatch_command": str(Path(bin_root or (Path.home() / ".local/bin")).expanduser().absolute() / "mlgo-v2-dispatch"),
            "systemctl_command": str(Path(systemctl_command).expanduser().absolute()),
            "systemd_run_command": str(Path(systemd_run_command).expanduser().absolute()),
            "controller_unit": "mlgo-cao-v2-controller.service",
            "bin_root": str(Path(bin_root or (Path.home() / ".local/bin")).expanduser().absolute()),
            "systemd_user_unit_root": str(Path(systemd_user_unit_root or (Path.home() / ".config/systemd/user")).expanduser().absolute()),
        },
    }
    return validate_instance(raw)


def render_safe_policy(
    template: dict[str, Any], instance: dict[str, Any]
) -> dict[str, Any]:
    """Project host-bound paths while forcing the already-approved safe posture."""
    instance = validate_instance(instance)
    policy = copy.deepcopy(template)
    if policy.get("schema_version") != "2.0":
        raise WB0ContractError("WB-0 supports the current CAO policy schema 2.0")
    state_root = Path(instance["roots"]["state_root"]) / "current"
    config_root = Path(instance["roots"]["config_root"]) / "current" / "payload"
    primary_project = Path(instance["project_roots"][0])
    policy["state_root"] = str(state_root)
    policy["repo_root"] = str(primary_project)
    policy["profile_source_dir"] = str(config_root / "profiles")
    policy.setdefault("capacity", {})["manual_hint_path"] = str(
        state_root / "governance" / "manual-capacity-hints.json"
    )
    policy.setdefault("orchestration", {})["default_mode"] = "v2_shadow"
    policy.setdefault("semantic_triggers", {})["enforcement_mode"] = "shadow_only"
    for capability in (policy.get("capability_activation") or {}).values():
        if isinstance(capability, dict):
            capability["enabled"] = False
    policy.setdefault("installation", {})["instance_id"] = instance["instance_id"]
    policy["installation"]["instance_digest"] = instance["instance_digest"]
    policy["installation"]["release_root"] = instance["roots"]["release_root"]
    policy["installation"]["config_root"] = instance["roots"]["config_root"]
    policy["installation"]["state_generation_pointer"] = str(state_root)
    policy["installation"]["skill_cache_root"] = instance["skill_bindings"]["cache_root"]
    policy["installation"]["native_skill_mirror_root"] = instance["skill_bindings"]["native_mirror_root"]
    policy["installation"]["skill_project_id"] = instance["skill_bindings"]["project_id"]
    policy["installation"]["skill_security_domain_id"] = instance["skill_bindings"]["security_domain_id"]
    policy["host_adapter"] = copy.deepcopy(instance["host_adapter"])
    policy["project_roots"] = list(instance["project_roots"])
    return policy


def render_instance_environment(instance: dict[str, Any]) -> str:
    instance = validate_instance(instance)
    release_current = Path(instance["roots"]["release_root"]) / "current"
    values = {
        "MLGO_CAO_INSTANCE_ID": instance["instance_id"],
        "MLGO_CAO_INSTANCE_DIGEST": instance["instance_digest"],
        "MLGO_CAO_V2_POLICY": instance["policy_bindings"]["policy_path"],
        "MLGO_CAO_V2_LIB": str(release_current / "release" / "lib"),
        "MLGO_CAO_V2_REGISTRY": str(
            release_current / "release" / "share" / "registry" / "provider-registry.json"
        ),
        "MLGO_CAO_V2_SKILL_LOCK": str(
            release_current
            / "release"
            / "share"
            / "skills"
            / "canonical-skill-bundles.lock.json"
        ),
        "MLGO_CAO_V2_SKILL_CACHE_ROOT": instance["skill_bindings"]["cache_root"],
        "MLGO_CAO_V2_NATIVE_SKILL_MIRROR_ROOT": instance["skill_bindings"]["native_mirror_root"],
        "MLGO_CAO_V2_SKILL_PROJECT_ID": instance["skill_bindings"]["project_id"],
        "MLGO_CAO_V2_SKILL_SECURITY_DOMAIN_ID": instance["skill_bindings"]["security_domain_id"],
    }
    return "\n".join(f"{key}={shlex.quote(value)}" for key, value in sorted(values.items())) + "\n"


def assert_safe_policy(policy: dict[str, Any]) -> None:
    if (policy.get("orchestration") or {}).get("default_mode") != "v2_shadow":
        raise WB0SafetyError("recovered policy is not in v2_shadow")
    if (policy.get("semantic_triggers") or {}).get("enforcement_mode") != "shadow_only":
        raise WB0SafetyError("recovered policy semantic enforcement is not shadow_only")
    enabled = sorted(
        name
        for name, item in (policy.get("capability_activation") or {}).items()
        if isinstance(item, dict) and item.get("enabled") is True
    )
    if enabled:
        raise WB0SafetyError(f"recovered policy has enabled provider capabilities: {enabled}")
