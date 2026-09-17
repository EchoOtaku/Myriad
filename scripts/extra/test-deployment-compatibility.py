"""Exercise bootstrap and release assembly without Docker or network access.

Run: python3 scripts/extra/test-deployment-compatibility.py
Requires bash and jq (available on the release runner).
"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[2]
# v0.4.10 first shipped both split-worker routing and updater capability gates.
ROUTING_FLOOR = (0, 4, 10)


def version(value):
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", value)
    if not match:
        raise AssertionError(f"Expected a pinned release, got {value!r}")
    return tuple(map(int, match.groups()))


def env_values(path):
    return dict(line.split("=", 1) for line in path.read_text().splitlines()
                if line and not line.startswith("#") and "=" in line)


class DeploymentCompatibility(unittest.TestCase):
    def bootstrap(self, directory, initial="", template=None):
        root = Path(directory)
        script_path = root / "scripts/extra/deploy.sh"
        script_path.parent.mkdir(parents=True)
        script = (ROOT / "scripts/extra/deploy.sh").read_text()
        # Load real shell functions, stopping before dispatch (which requires Docker).
        library = script.split("COMPOSE_KIND=$(detect_compose)", 1)[0]
        script_path.write_text(library + "\nensure_current_layout\n")
        (root / ".env").write_text(initial)
        (root / ".env.production.example").write_text(
            template or (ROOT / ".env.production.example").read_text())
        subprocess.run(["bash", str(script_path)], check=True, capture_output=True, text=True)
        return env_values(root / ".env")

    def test_bootstrap_defaults_support_split_worker_routes(self):
        with tempfile.TemporaryDirectory() as directory:
            values = self.bootstrap(directory)
        for key in ["PROXY_TAG", "UPDATER_TAG"]:
            with self.subTest(key=key):
                self.assertGreaterEqual(version(values[key]), ROUTING_FLOOR)

    def test_bootstrap_reads_release_defaults_from_template(self):
        template = "MYRIAD_TAG=v1.2.3\nPROXY_TAG=v1.1.0\nUPDATER_TAG=v1.0.0\n"
        with tempfile.TemporaryDirectory() as directory:
            values = self.bootstrap(directory, template=template)
        self.assertEqual(values["MYRIAD_TAG"], "v1.2.3")
        self.assertEqual(values["PROXY_TAG"], "v1.1.0")
        self.assertEqual(values["UPDATER_TAG"], "v1.0.0")

    def test_bootstrap_preserves_operator_pins(self):
        with tempfile.TemporaryDirectory() as directory:
            values = self.bootstrap(directory, "MYRIAD_TAG=dev-abcdef1\nPROXY_TAG=v0.4.13\nUPDATER_TAG=v0.4.13\n")
        self.assertEqual(values["MYRIAD_TAG"], "dev-abcdef1")
        self.assertEqual(values["PROXY_TAG"], "v0.4.13")
        self.assertEqual(values["UPDATER_TAG"], "v0.4.13")

    def test_release_requires_updater_with_edge_capability_checks(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        step = workflow.split("      - name: Assemble release.json\n", 1)[1].split("\n      - name:", 1)[0]
        script = textwrap.dedent(step.split("        run: |\n", 1)[1])
        for expression, value in {
            "${{ env.IMAGE_NAMESPACE }}": "fixture",
            "${{ env.REGISTRY }}": "docker.io",
            "${{ github.repository }}": "fixture/myriad",
        }.items():
            script = script.replace(expression, value)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "_digests").mkdir()
            # No infra release: compatibility requirement must survive independent cadence.
            for component in ["backend", "frontend"]:
                (root / f"_digests/{component}.digest").write_text("sha256:" + "0" * 64)
            subprocess.run(["bash", "-c", script], cwd=root, check=True, capture_output=True,
                           env={**os.environ, "VERSION": "v0.4.99", "CHANNEL": "stable", "COMMIT_SHA": "a" * 40})
            manifest = json.loads((root / "release.json").read_text())
        self.assertGreaterEqual(version(manifest["updater"]["min_updater_version"]), ROUTING_FLOOR)
        self.assertNotIn("proxy", manifest["images"])
        self.assertNotIn("updater", manifest["images"])


if __name__ == "__main__":
    unittest.main()
