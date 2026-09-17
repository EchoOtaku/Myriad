"""Exercise bootstrap, release assembly and TAG-first Compose selection.

Run: python3 scripts/extra/test-deployment-compatibility.py
Requires bash and jq (available on the release runner). Compose selection tests
also use the Docker Compose CLI, but never connect to a daemon or pull images.
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

    def test_guard_policy_bootstrap_resolves_tag_instead_of_stale_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script_path = root / "scripts/extra/deploy.sh"
            script_path.parent.mkdir(parents=True)
            (root / "guard-policy").mkdir()
            script = (ROOT / "scripts/extra/deploy.sh").read_text()
            library = script.split("COMPOSE_KIND=$(detect_compose)", 1)[0]
            digest = "docker.io/somekawahitomi/myriad-updater@sha256:" + "b" * 64
            mock = f'''
docker() {{
    printf '%s\\n' "$*" >> docker.calls
    case "$*" in
        "pull docker.io/somekawahitomi/myriad-updater:v0.4.14") return 0 ;;
        "image inspect --format "*) printf '%s\\n' '{digest}' ;;
        *) return 1 ;;
    esac
}}
seed_guard_policy_from_env
'''
            script_path.write_text(library + mock)
            (root / ".env").write_text(
                "UPDATER_TAG=v0.4.14\nDOCKER_GUARD_IMAGE=old-pin\n"
                "GUARD_SELF_UPDATE_TOKEN=test-only-bootstrap-token-00000000\n")
            subprocess.run(["bash", str(script_path)], check=True, capture_output=True, text=True)
            self.assertEqual(env_values(root / "guard-policy/docker-guard.env")["DOCKER_GUARD_IMAGE"], digest)
            calls = (root / "docker.calls").read_text()
            self.assertNotIn("old-pin", calls)
            self.assertIn("pull docker.io/somekawahitomi/myriad-updater:v0.4.14", calls)

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

    def test_doctor_verifies_actual_tag_image_instead_of_requiring_a_pin_selector(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script_path = root / "scripts/extra/deploy.sh"
            script_path.parent.mkdir(parents=True)
            library = (ROOT / "scripts/extra/deploy.sh").read_text().split("COMPOSE_KIND=$(detect_compose)", 1)[0]
            image_id = "sha256:" + "a" * 64
            digest = "docker.io/somekawahitomi/myriad-updater@sha256:" + "b" * 64
            checks = f'''
docker() {{
    case "$4" in
        "{{{{.Id}}}}") printf '%s\\n' '{image_id}' ;;
        *) printf '%s\\n' '{digest}' ;;
    esac
}}
guard_image_matches_selection 'docker.io/somekawahitomi/myriad-updater:v0.4.14' '{image_id}'
guard_image_matches_selection '{digest}' '{image_id}'
if guard_image_matches_selection 'docker.io/somekawahitomi/myriad-updater:v0.4.14' 'sha256:{"c" * 64}'; then exit 10; fi
if guard_image_matches_selection 'evil.example/updater:v0.4.14' '{image_id}'; then exit 11; fi
if guard_image_matches_selection 'docker.io/somekawahitomi/myriad-updater:latest' '{image_id}'; then exit 12; fi
'''
            script_path.write_text(library + checks)
            subprocess.run(["bash", str(script_path)], check=True, capture_output=True, text=True)


class ComposeTagSelection(unittest.TestCase):
    templates = ("docker-compose.yml", "docs/deployment/examples/docker-compose.external-db.example.yml")

    @classmethod
    def setUpClass(cls):
        try:
            subprocess.run(["docker", "compose", "version"], check=True, capture_output=True)
        except (OSError, subprocess.CalledProcessError):
            raise unittest.SkipTest("Docker Compose CLI unavailable; daemon not required")

    def resolve(self, directory, template, tag):
        root = Path(directory)
        values = {
            "MYRIAD_TAG": "v0.4.14", "PROXY_TAG": "v0.3.32", "UPDATER_TAG": tag,
            "DOCKER_GUARD_IMAGE": "docker.io/somekawahitomi/myriad-updater@sha256:" + "a" * 64,
            "UPDATER_IMAGE_REF": "docker.io/somekawahitomi/myriad-updater@sha256:" + "b" * 64,
            "UPDATER_GATEWAY_IMAGE_REF": "docker.io/somekawahitomi/myriad-updater@sha256:" + "c" * 64,
            "DATABASE_URL": "postgres://test:test@db:5432/test",
            "PERSONA_DATABASE_URL": "postgres://test:test@db:5432/test",
            "FEDERATION_DATABASE_URL": "postgres://test:test@db:5432/test",
        }
        for key in ("PERSONA_DB_PASSWORD", "FEDERATION_DB_PASSWORD", "POSTGRES_PASSWORD", "JWT_SECRET",
                    "MYRIAD_SETUP_SECRET", "GUARD_SELF_UPDATE_TOKEN", "UPDATE_TOKEN", "UPDATER_GATEWAY_SECRET"):
            values[key] = "test-only-no-real-credentials"
        (root / ".env").write_text("".join(f"{key}={value}\n" for key, value in values.items()))
        (root / "guard.env").write_text(f"DOCKER_GUARD_IMAGE={values['DOCKER_GUARD_IMAGE']}\n")
        env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "SYSTEMROOT") if key in os.environ}
        return subprocess.run([
            "docker", "compose", "--project-directory", str(root),
            "--env-file", str(root / ".env"), "--env-file", str(root / "guard.env"),
            "-f", str(ROOT / template), "config", "--no-env-resolution", "--format", "json",
        ], capture_output=True, text=True, env=env)

    def test_only_changing_tag_changes_all_tcb_images_despite_old_pins(self):
        for template in self.templates:
            with self.subTest(template=template), tempfile.TemporaryDirectory() as directory:
                for tag in ("v0.4.6", "v0.4.14", "dev-abcdef1"):
                    result = self.resolve(directory, template, tag)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    services = json.loads(result.stdout)["services"]
                    target = f"docker.io/somekawahitomi/myriad-updater:{tag}"
                    for service in ("docker-guard", "updater", "updater-gateway"):
                        self.assertEqual(services[service]["image"], target)
                        self.assertNotIn("MYRIAD_VERSION", services[service].get("environment", {}))
                    self.assertEqual(services["docker-guard"]["environment"]["DOCKER_GUARD_EXPECTED_IMAGE"], target)
                    self.assertEqual(services["backend"]["image"], "docker.io/somekawahitomi/myriad-backend:v0.4.14")
                    self.assertEqual(services["proxy"]["image"], "docker.io/somekawahitomi/myriad-proxy:v0.3.32")

    def test_missing_tag_does_not_silently_fall_back_to_old_pin(self):
        for template in self.templates:
            with self.subTest(template=template), tempfile.TemporaryDirectory() as directory:
                result = self.resolve(directory, template, "")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("UPDATER_TAG", result.stderr)


if __name__ == "__main__":
    unittest.main()
