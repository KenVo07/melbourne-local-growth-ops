from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from mlgo_cao_v2.wb0_common import write_all


class CommonFilesystemTest(unittest.TestCase):
    def test_write_all_handles_short_writes(self):
        with tempfile.TemporaryDirectory() as td:
            target = Path(td) / "out.bin"
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            real_write = os.write

            def short_write(target_fd: int, data) -> int:
                return real_write(target_fd, bytes(data[:3]))

            try:
                with mock.patch("mlgo_cao_v2.wb0_common.os.write", side_effect=short_write):
                    write_all(fd, b"0123456789abcdef")
                os.fsync(fd)
            finally:
                os.close(fd)
            self.assertEqual(target.read_bytes(), b"0123456789abcdef")


if __name__ == "__main__":
    unittest.main()
