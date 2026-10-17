"""Optional loader preparation comparison; never a validator dependency/release."""

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys

ROOT = Path(__file__).absolute().parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "tests"))
from project_manifest import check_candidate
from test_candidate import BASE, STACK, changed, full_declaration_shape

ENGINES = frozenset({"PyYAML.SafeLoader", "PyYAML.CSafeLoader", "Ruby.Psych"})
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9.+-]*")
PROFILE_ID = re.compile(r"[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*")
MAX_PROFILE_BYTES = 65_536

RUBY = """
require 'psych'
require 'json'
if ARGV == ['version']
  puts JSON.generate({ruby: RUBY_VERSION, psych: Psych::VERSION, libyaml: Psych.libyaml_version})
else
  text = STDIN.read
  begin
    value = if Psych::VERSION.split('.')[0].to_i < 4
      Psych.safe_load(text, [], [], false)
    else
      Psych.safe_load(text, permitted_classes: [], permitted_symbols: [], aliases: false)
    end
  rescue Psych::Exception
    exit 65
  end
  puts JSON.generate(value)
end
"""


class Unavailable(Exception):
    """Fixed preparation code, never exception text or an executable path."""


def vectors():
    accepted = {"base": BASE, "stack": changed(b"  stacks: {}\n", STACK),
                "comment": b"# Synthetic comparison\n\n" + BASE,
                "quoted_reserved": changed(b'  display_name: "Synthetic example"\n', b'  display_name: "yes"\n')}
    for owner in ("none", "direnv", "mise", "project"):
        accepted["activation_" + owner] = changed(b"    owner: sample-activation\n", b"    owner: " + owner.encode() + b"\n")
    accepted["full_shape"] = full_declaration_shape()
    accepted["singleton_list"] = changed(b"peers: []\n", b"peers: [a]\n")
    accepted["ordered_lists"] = BASE.replace(b"peers: []\n", b"peers: [sample_two, sample-one]\n").replace(
        b"  platforms: []\n", b"  platforms: [linux-x86_64, macos-arm64]\n").replace(
        b"  host_requirements: []\n", b"  host_requirements: [android_sdk, container_engine]\n")
    accepted["duplicate_list"] = changed(b"peers: []\n", b"peers: [sample-peer, sample-peer]\n")
    accepted["quoted_null_and_numeric"] = BASE.replace(b"  public_alias: null\n", b'  public_alias: "null"\n').replace(
        b'  display_name: "Synthetic example"\n', b'  display_name: "001"\n')
    accepted["quoted_punctuation"] = changed(b'  display_name: "Synthetic example"\n', b'  display_name: "# literal: [] {}"\n')
    accepted["reordered_keys"] = BASE.replace(b"role: sample-role\ncanonical: null\n", b"canonical: null\nrole: sample-role\n").replace(
        b'  id: sample-project\n  display_name: "Synthetic example"\n  owner_entity: sample-owner\n',
        b'  owner_entity: sample-owner\n  display_name: "Synthetic example"\n  id: sample-project\n')
    accepted["interior_comments"] = BASE.replace(b"  id: sample-project\n", b"     # Synthetic odd interior comment\n  id: sample-project\n").replace(
        b"    owner: sample-activation\n", b"          # Synthetic deep interior comment\n    owner: sample-activation\n")
    second = b'''    second-stack_two:
      compose: "stacks/second.example"
      instance_scope: checkout
      port_policy: loopback_only
'''
    accepted["two_mixed_stack_keys"] = changed(b"  stacks: {}\n", STACK.replace(b"sample-stack:", b"first_stack-one:") + second)
    accepted["token_limits"] = changed(b"  stacks: {}\n", STACK.replace(b"sample-stack:", b"b" * 64 + b":")).replace(
        b"  id: sample-project\n", b"  id: " + b"a" * 64 + b"\n")
    data = full_declaration_shape()
    for old, key, length in (
        (b'  display_name: "Synthetic example"\n', b"  display_name", 100),
        (b'  public_alias: "Synthetic alias"\n', b"  public_alias", 100),
        (b'  local_phase: "Synthetic phase"\n', b"  local_phase", 400),
        (b'  status_of_record: "docs/status.example"\n', b"  status_of_record", 255),
        (b'      target: "check-example"\n', b"      target", 255),
        (b'    template: "config/example.env"\n', b"    template", 255),
        (b'    secret_launcher: "scripts/example-launcher"\n', b"    secret_launcher", 255),
        (b'      compose: "stacks/compose.example"\n', b"      compose", 255),
    ):
        data = changed(old, key + b': "' + b"x" * length + b'"\n', data)
    accepted["text_and_path_limits"] = data
    accepted["minimum_scalars"] = BASE.replace(b"  id: sample-project\n", b"  id: a\n").replace(
        b'  display_name: "Synthetic example"\n', b'  display_name: "x"\n').replace(
        b'  local_phase: "Synthetic phase"\n', b'  local_phase: "x"\n').replace(
        b'  status_of_record: "docs/status.example"\n', b'  status_of_record: "x"\n')
    accepted["file_limit"] = BASE + b"\n" * (65_536 - len(BASE))
    accepted["line_limit"] = BASE + b"#" + b"x" * 2047 + b"\n"
    refused = {
        "duplicate_key": BASE + b'authority:\n  status_of_record: "docs/status.example"\n',
        "reserved_token": changed(b"role: sample-role\n", b"role: yes\n"),
        "single_quote": changed(b'  display_name: "Synthetic example"\n', b"  display_name: 'Synthetic example'\n"),
        "flow_map": changed(b"project:\n", b"project: {}\n"),
        "unicode": changed(b'  display_name: "Synthetic example"\n', '  display_name: "Synthetic caf\u00e9"\n'.encode()),
        "legacy_version": changed(b'spec_version: "1"\n', b"spec_version: 0.1\n"),
        "crlf": BASE.replace(b"\n", b"\r\n"),
    }
    return accepted, refused


def exact_version(value):
    return type(value) is str and VERSION.fullmatch(value) is not None


def versions_valid(engine, value):
    keys = {"ruby", "psych", "libyaml"} if engine == "Ruby.Psych" else {"pyyaml", "libyaml"}
    if type(value) is not dict or set(value) != keys or any(not exact_version(value[k]) for k in keys - {"libyaml"}):
        return False
    linked = value["libyaml"]
    return ((linked is None and engine == "PyYAML.SafeLoader") or
            type(linked) is list and len(linked) == 3 and all(type(n) is int and n >= 0 for n in linked))


def selection_valid(value):
    if type(value) is not dict or set(value) != {"python", "profiles"} or not exact_version(value["python"]):
        return False
    profiles = value["profiles"]
    if type(profiles) is not list or not 1 <= len(profiles) <= 8:
        return False
    seen = set()
    for profile in profiles:
        if type(profile) is not dict or type(profile.get("engine")) is not str or profile["engine"] not in ENGINES:
            return False
        keys = {"id", "engine", "versions"} | ({"executable"} if profile["engine"] == "Ruby.Psych" else set())
        if set(profile) != keys or type(profile["id"]) is not str or len(profile["id"]) > 64 or not PROFILE_ID.fullmatch(profile["id"]) or profile["id"] in seen:
            return False
        if not versions_valid(profile["engine"], profile["versions"]):
            return False
        if profile["engine"] == "Ruby.Psych" and (type(profile["executable"]) is not str or not Path(profile["executable"]).is_absolute()):
            return False
        seen.add(profile["id"])
    return True


def ruby_loader(executable, data):
    result = subprocess.run([executable, "-e", RUBY], input=data, capture_output=True, timeout=5, check=False)
    if result.returncode == 65:
        raise ValueError("LOADER_REFUSED")
    if result.returncode:
        raise Unavailable("ENGINE_EXECUTION_UNAVAILABLE")
    try:
        return json.loads(result.stdout)
    except (ValueError, UnicodeError):
        raise Unavailable("ENGINE_EXECUTION_UNAVAILABLE") from None


def initialize(profile):
    engine = profile["engine"]
    if engine.startswith("PyYAML."):
        try:
            yaml = importlib.import_module("yaml")
        except ModuleNotFoundError:
            raise Unavailable("ENGINE_MISSING") from None
        loader = getattr(yaml, engine.split(".")[1], None)
        if loader is None:
            raise Unavailable("ENGINE_MISSING")
        linked = None
        if getattr(yaml, "__with_libyaml__", False):
            # Official PyYAML extension API reports the actually linked library.
            linked = list(importlib.import_module("yaml._yaml").get_version())
        versions = {"pyyaml": yaml.__version__, "libyaml": linked}
        return versions, lambda data: yaml.load(data, Loader=loader)
    path = Path(profile["executable"])
    if not path.is_file() or not os.access(path, os.X_OK):
        raise Unavailable("ENGINE_MISSING")
    version = subprocess.run([str(path), "-e", RUBY, "version"], capture_output=True, timeout=5, check=False)
    if version.returncode:
        raise Unavailable("ENGINE_INIT_FAILED")
    return json.loads(version.stdout), lambda data: ruby_loader(str(path), data)


def discover():
    loaders, unavailable = [], []
    for engine in ("PyYAML.SafeLoader", "PyYAML.CSafeLoader"):
        try:
            versions, load = initialize({"engine": engine})
            loaders.append((engine, versions, load))
        except Exception:
            unavailable.append(engine)
    for path in sorted({str(Path(p).resolve()) for p in ("/usr/bin/ruby", "/opt/homebrew/bin/ruby") if Path(p).is_file()}):
        try:
            versions, load = initialize({"engine": "Ruby.Psych", "executable": path})
            loaders.append(("Ruby.Psych." + versions["psych"], versions, load))
        except Exception:
            unavailable.append("Ruby.Psych")
    return loaders, unavailable


def compare(*, selection=None, initializer=None, discovery=None, supplied_vectors=None, python_version=None):
    selected = selection is not None
    current_python = platform.python_version() if python_version is None else python_version
    report = {"scope": "fresh-selected-loader-synthetic-comparison" if selected else "fresh-installed-loader-synthetic-comparison",
              "exit_code": 2, "python": current_python, "host": platform.system(), "machine": platform.machine(),
              "selected_comparison": "not_checked", "release_qualification": "not_checked", "other_loaders": "not_checked",
              "loaders": [], "unavailable": [], "requirements": []}
    source_paths = ("tests/compare_loaders.py", "tests/test_candidate.py", "src/project_manifest/candidate.py")
    report["source_sha256"] = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in source_paths}
    if selected and not selection_valid(selection):
        report["reason"] = "SELECTION_INPUT"
        return report
    accepted, refused = vectors() if supplied_vectors is None else supplied_vectors
    strict = {name: check_candidate(data) for name, data in accepted.items()}
    if not accepted or any(result.exit_code for result in strict.values()) or any(check_candidate(data).exit_code != 1 for data in refused.values()):
        report.update(exit_code=1, reason="STRICT_CONTROL_FAILED", selected_comparison="failed" if selected else "not_checked")
        return report
    report.update(accepted_vectors=len(accepted), strict_refusal_vectors=len(refused),
                  vectors={name: hashlib.sha256(data).hexdigest() for name, data in (accepted | refused).items()})
    loaders = []
    if selected:
        report["selection_sha256"] = hashlib.sha256(json.dumps(selection, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        if selection["python"] != current_python:
            report["reason"] = "PYTHON_VERSION_MISMATCH"
            return report
        start = initialize if initializer is None else initializer
        for profile in selection["profiles"]:
            requirement = {"profile": profile["id"], "engine": profile["engine"], "expected_versions": profile["versions"]}
            try:
                versions, load = start(profile)
                if not versions_valid(profile["engine"], versions) or not callable(load):
                    raise Unavailable("ENGINE_INIT_FAILED")
                requirement["actual_versions"] = versions
                requirement["code"] = "SATISFIED" if versions == profile["versions"] else "VERSION_MISMATCH"
            except Exception as error:
                requirement["code"] = str(error) if isinstance(error, Unavailable) and str(error) in {"ENGINE_MISSING", "ENGINE_INIT_FAILED"} else "ENGINE_INIT_FAILED"
            report["requirements"].append(requirement)
            if requirement["code"] == "SATISFIED":
                loaders.append((profile["id"], versions, load))
        if any(item["code"] != "SATISFIED" for item in report["requirements"]):
            report["reason"] = "SELECTED_REQUIREMENT_UNAVAILABLE"
            return report
    else:
        loaders, report["unavailable"] = (discover if discovery is None else discovery)()
    mismatch = False
    for name, versions, load in loaders:
        agreements, differences, broad = [], [], []
        loader_report = {"loader": name, "version": versions, "agreements": agreements,
                         "differences": differences, "broader_yaml_acceptance": broad}
        report["loaders"].append(loader_report)
        for label, data in accepted.items():
            try:
                agreed = load(data) == strict[label].record
            except (Unavailable, OSError, subprocess.TimeoutExpired):
                loader_report.update(execution="unavailable", phase="accepted", unavailable_vector=label)
                report["unavailable"].append(name)
                report.update(exit_code=2, reason="LOADER_EXECUTION_UNAVAILABLE")
                return report
            except Exception:
                agreed = False
            (agreements if agreed else differences).append(label)
        for label, data in refused.items():
            try:
                load(data)
                broad.append(label)
            except (Unavailable, OSError, subprocess.TimeoutExpired):
                loader_report.update(execution="unavailable", phase="strict_refusal", unavailable_vector=label)
                report["unavailable"].append(name)
                report.update(exit_code=2, reason="LOADER_EXECUTION_UNAVAILABLE")
                return report
            except Exception:
                pass
        mismatch = mismatch or bool(differences)
    report["exit_code"] = 1 if mismatch else (0 if loaders else 2)
    if selected:
        report["selected_comparison"] = "failed" if mismatch else "passed"
    return report


def read_selection(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise Unavailable("SELECTION_INPUT")
            result[key] = value
        return result
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_PROFILE_BYTES + 1)
    if len(data) > MAX_PROFILE_BYTES:
        raise Unavailable("SELECTION_INPUT")
    return json.loads(data, object_pairs_hook=pairs)


def main(argv=None):
    class Parser(argparse.ArgumentParser):
        def error(self, message):
            raise Unavailable("SELECTION_INPUT")
    parser = Parser(description="Optional loader comparison, never release approval")
    parser.add_argument("--selected-profiles", metavar="FILE")
    try:
        args = parser.parse_args(argv)
        selection = read_selection(args.selected_profiles) if args.selected_profiles is not None else None
        if args.selected_profiles and selection is None:
            raise Unavailable("SELECTION_INPUT")
        report = compare(selection=selection)
    except (Unavailable, OSError, ValueError, TypeError):
        report = {"exit_code": 2, "reason": "SELECTION_INPUT", "selected_comparison": "not_checked", "release_qualification": "not_checked"}
    print(json.dumps(report, indent=2, sort_keys=True))
    return report["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
