from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from _wb0_test_support import SKILL_MIRROR_NAME, make_capsule
from mlgo_cao_v2.wb0_common import WB0IntegrityError
from mlgo_cao_v2.wb0_skills import verify_skill_capsule


CONTRACT = {
    "sealed_bytes_required": True,
    "canonical_lock_required": True,
    "mirror_must_be_digest_equivalent": True,
    "new_skill_sources_allowed": False,
}


class SkillCapsuleTest(unittest.TestCase):
    def test_native_mirror_drift_is_rejected_against_sealed_object(self):
        with tempfile.TemporaryDirectory() as td:
            capsule = make_capsule(Path(td))
            target = capsule / "skills/native-mirror" / SKILL_MIRROR_NAME / "SKILL.md"
            os.chmod(target, 0o600)
            target.write_text("drifted native mirror\n")
            os.chmod(target, 0o400)
            with self.assertRaises(WB0IntegrityError):
                verify_skill_capsule(capsule, CONTRACT)

    def test_active_and_evidence_lock_bytes_must_match(self):
        with tempfile.TemporaryDirectory() as td:
            capsule = make_capsule(Path(td))
            target = capsule / "skills/lock/canonical-skill-bundles.lock.json"
            os.chmod(target, 0o600)
            target.write_text('{"lock_schema_version":"1.0"}\n')
            os.chmod(target, 0o400)
            with self.assertRaises(WB0IntegrityError):
                verify_skill_capsule(capsule, CONTRACT)


if __name__ == "__main__":
    unittest.main()
