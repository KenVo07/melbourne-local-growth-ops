from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.wb0_common import WB0IntegrityError, WB0SafetyError
from mlgo_cao_v2.wb0_state import (
    activate_generation,
    active_generation_id,
    clone_generation,
    create_generation,
    golden_generation_id,
    seal_golden_pointer,
    verify_generation,
    verify_initial_clone,
)


class StateGenerationTest(unittest.TestCase):
    def test_golden_pointer_repairs_escaping_tamper_but_not_valid_reselection(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            seed = root / "seed"
            seed.mkdir()
            (seed / "state.json").write_text('{"value":"golden"}\n')
            state_root = root / "state"
            for generation_id in ("golden-a", "golden-b"):
                create_generation(
                    state_root=state_root,
                    generation_id=generation_id,
                    source_payload=seed,
                    source_release_id="release-a",
                    state_schema_version="2.1",
                    compatible_release_ids=["release-a"],
                    immutable=True,
                    created_at="2026-08-10T00:00:00Z",
                )

            seal_golden_pointer(state_root=state_root, generation_id="golden-a")
            pointer = state_root / "golden"
            pointer.unlink()
            pointer.symlink_to("../escaping-target")
            repaired = seal_golden_pointer(
                state_root=state_root, generation_id="golden-a"
            )
            self.assertEqual(repaired["target"], "generations/golden-a")
            self.assertEqual(pointer.readlink().as_posix(), "generations/golden-a")

            with self.assertRaises(WB0SafetyError):
                seal_golden_pointer(state_root=state_root, generation_id="golden-b")

    def test_immutable_golden_and_writable_clone(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            seed = root / "seed"
            (seed / "runs/r1/v2").mkdir(parents=True)
            (seed / "runs/r1/v2/state.json").write_text('{"schema_version":"2.1"}\n')
            state_root = root / "state"
            golden = create_generation(
                state_root=state_root,
                generation_id="golden-g1",
                source_payload=seed,
                source_release_id="release-a",
                state_schema_version="2.1",
                compatible_release_ids=["release-a"],
                immutable=True,
                created_at="2026-08-10T00:00:00Z",
            )
            seal_golden_pointer(state_root=state_root, generation_id="golden-g1")
            clone = clone_generation(
                state_root=state_root,
                source_generation_id="golden-g1",
                new_generation_id="work-g2",
                target_release_id="release-a",
                created_at="2026-08-10T00:01:00Z",
            )
            activate_generation(state_root=state_root, generation_id="work-g2", release_id="release-a")
            self.assertTrue(golden["immutable"])
            self.assertFalse(clone["immutable"])
            self.assertEqual(golden_generation_id(state_root), "golden-g1")
            self.assertEqual(active_generation_id(state_root), "work-g2")
            with self.assertRaises(WB0SafetyError):
                verify_generation(state_root, "work-g2", release_id="release-b")

    def test_writable_generation_identity_survives_legitimate_runtime_evolution(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            seed = root / "seed"
            seed.mkdir()
            (seed / "state.json").write_text('{"value":1}\n')
            state_root = root / "state"
            create_generation(
                state_root=state_root,
                generation_id="golden-evolve",
                source_payload=seed,
                source_release_id="release-a",
                state_schema_version="2.1",
                compatible_release_ids=["release-a"],
                immutable=True,
                created_at="2026-08-10T00:00:00Z",
            )
            clone_generation(
                state_root=state_root,
                source_generation_id="golden-evolve",
                new_generation_id="work-evolve",
                target_release_id="release-a",
                created_at="2026-08-10T00:01:00Z",
            )
            activate_generation(
                state_root=state_root,
                generation_id="work-evolve",
                release_id="release-a",
                require_initial_clone=True,
            )
            live = state_root / "generations/work-evolve/payload/state.json"
            live.write_bytes(b'{"value":2,"progress":"legitimate"}\n')
            before = live.read_bytes()
            metadata = verify_generation(
                state_root, "work-evolve", release_id="release-a", require_immutable=False
            )
            self.assertEqual(metadata["source_generation_id"], "golden-evolve")
            self.assertEqual(live.read_bytes(), before)
            with self.assertRaises(WB0IntegrityError):
                verify_initial_clone(state_root, "work-evolve")

    def test_rollback_selects_fresh_writable_generation_without_touching_evolved_prior(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            seed = root / "seed"
            seed.mkdir()
            (seed / "state.json").write_text('{"value":"golden"}\n')
            state_root = root / "state"
            create_generation(
                state_root=state_root,
                generation_id="golden-rollback",
                source_payload=seed,
                source_release_id="release-a",
                state_schema_version="2.1",
                compatible_release_ids=["release-a"],
                immutable=True,
                created_at="2026-08-10T00:00:00Z",
            )
            clone_generation(
                state_root=state_root,
                source_generation_id="golden-rollback",
                new_generation_id="work-old",
                target_release_id="release-a",
                created_at="2026-08-10T00:01:00Z",
            )
            activate_generation(
                state_root=state_root,
                generation_id="work-old",
                release_id="release-a",
                require_initial_clone=True,
            )
            prior = state_root / "generations/work-old/payload/state.json"
            prior.write_bytes(b'{"value":"evolved","checkpoint":7}\n')
            prior_before = prior.read_bytes()
            clone_generation(
                state_root=state_root,
                source_generation_id="golden-rollback",
                new_generation_id="work-rollback-fresh",
                target_release_id="release-a",
                created_at="2026-08-10T00:02:00Z",
            )
            activate_generation(
                state_root=state_root,
                generation_id="work-rollback-fresh",
                release_id="release-a",
                require_initial_clone=True,
            )
            self.assertEqual(active_generation_id(state_root), "work-rollback-fresh")
            self.assertEqual(prior.read_bytes(), prior_before)
            self.assertEqual(
                (state_root / "generations/work-rollback-fresh/payload/state.json").read_text(),
                '{"value":"golden"}\n',
            )

    def test_generation_id_collision_with_different_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            first = root / "first"
            second = root / "second"
            first.mkdir()
            second.mkdir()
            (first / "state.json").write_text('{"value":1}\n')
            (second / "state.json").write_text('{"value":2}\n')
            state_root = root / "state"
            create_generation(
                state_root=state_root,
                generation_id="same-id",
                source_payload=first,
                source_release_id="release-a",
                state_schema_version="2.1",
                compatible_release_ids=["release-a"],
                immutable=True,
                created_at="2026-08-10T00:00:00Z",
            )
            with self.assertRaises(WB0IntegrityError):
                create_generation(
                    state_root=state_root,
                    generation_id="same-id",
                    source_payload=second,
                    source_release_id="release-a",
                    state_schema_version="2.1",
                    compatible_release_ids=["release-a"],
                    immutable=True,
                    created_at="2026-08-10T00:00:00Z",
                )

    def test_generation_id_collision_with_different_source_mode_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            first = root / "first"
            second = root / "second"
            first.mkdir()
            second.mkdir()
            (first / "state.json").write_text('{"value":1}\n')
            (second / "state.json").write_text('{"value":1}\n')
            (first / "state.json").chmod(0o600)
            (second / "state.json").chmod(0o644)
            state_root = root / "state"
            create_generation(
                state_root=state_root,
                generation_id="same-mode-id",
                source_payload=first,
                source_release_id="release-a",
                state_schema_version="2.1",
                compatible_release_ids=["release-a"],
                immutable=True,
                created_at="2026-08-10T00:00:00Z",
            )
            with self.assertRaises(WB0IntegrityError):
                create_generation(
                    state_root=state_root,
                    generation_id="same-mode-id",
                    source_payload=second,
                    source_release_id="release-a",
                    state_schema_version="2.1",
                    compatible_release_ids=["release-a"],
                    immutable=True,
                    created_at="2026-08-10T00:00:00Z",
                )

    def test_generation_root_extra_entry_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            seed = root / "seed"
            seed.mkdir()
            (seed / "state.json").write_text('{}\n')
            state_root = root / "state"
            create_generation(
                state_root=state_root,
                generation_id="golden-layout",
                source_payload=seed,
                source_release_id="release-a",
                state_schema_version="2.1",
                compatible_release_ids=["release-a"],
                immutable=True,
                created_at="2026-08-10T00:00:00Z",
            )
            generation = state_root / "generations/golden-layout"
            generation.chmod(0o700)
            (generation / "unexpected.txt").write_text("unexpected\n")
            (generation / "unexpected.txt").chmod(0o400)
            generation.chmod(0o500)
            with self.assertRaises(WB0IntegrityError):
                verify_generation(state_root, "golden-layout")

    def test_golden_generation_metadata_and_payload_are_non_writable(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            seed = root / "seed"
            seed.mkdir()
            (seed / "state.json").write_text('{}\n')
            state_root = root / "state"
            create_generation(
                state_root=state_root,
                generation_id="golden-modes",
                source_payload=seed,
                source_release_id="release-a",
                state_schema_version="2.1",
                compatible_release_ids=["release-a"],
                immutable=True,
                created_at="2026-08-10T00:00:00Z",
            )
            generation = state_root / "generations/golden-modes"
            for path in (generation, generation / "generation.json", generation / "SEALED.json", generation / "payload", generation / "payload/state.json"):
                self.assertEqual(path.stat().st_mode & 0o222, 0, path)


if __name__ == "__main__":
    unittest.main()
