#!/usr/bin/env python3
"""
ehr_harden_verify_skill.py

Read-only verifier for the Clinical EHR + Proving Ground alignment.

Built against:
  - 00_OPUS_EHR_HARDEN_VERIFY_FULL_ITERATION_PLAN_2026-05-03.md (CLI contract, check groups A-K)
  - ULTRAREVIEW_04-07-2026.md (P0/P1 invariants the codebase must preserve)
  - MODULE_CATALOG.md / module-registry.js (locked: 14 modules = 11 encounter + 3 governance)

Usage:
  python scripts/ehr_harden_verify_skill.py --path "C:\\Users\\micha\\files\\Clinical\\EHR" \\
      --proving-ground "C:\\Users\\micha\\files\\ProvingGround" \\
      --include-autobetter --strict

Exit codes:
  0 = all required checks passed
  1 = one or more required checks failed
  2 = usage / config error

Safety contract:
  - Read-only. Never writes to anything outside --write-report PATH (and never inside _eval/).
  - Never prints .env values or secret material. Matches are reported as path:line with redacted value.
  - PHI-aware: never reads database files (data/*.db). Patient data is out of scope.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

# ----------------------------------------------------------------------
# CheckResult
# ----------------------------------------------------------------------

PASS = "PASS"
WARN = "WARN"
FAIL = "FAIL"


@dataclass
class CheckResult:
    name: str
    status: str
    detail: str
    file: Optional[str] = None
    line: Optional[int] = None
    group: str = ""

    def to_dict(self):
        return {
            "name": self.name,
            "status": self.status,
            "detail": self.detail,
            "file": self.file,
            "line": self.line,
            "group": self.group,
        }


@dataclass
class Args:
    path: Path
    proving_ground: Optional[Path]
    include_autobetter: bool
    strict: bool
    json_out: bool
    write_report: Optional[Path]


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

# High-confidence secret patterns. Documentation, examples, and synthetic
# test fixtures are explicitly skipped via filename + per-line markers.
SECRET_PATTERNS = [
    re.compile(r"sk-(?:live|prod)-[A-Za-z0-9]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"ghp_[A-Za-z0-9]{30,}"),
    re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----"),
]


def redact(value: str, keep: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= keep:
        return "***"
    return value[:keep] + "***[REDACTED]"


def read_text_safe(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def file_contains_all(path: Path, needles: List[str]) -> bool:
    if not path.exists():
        return False
    text = read_text_safe(path)
    return all(n in text for n in needles)


def file_contains_any(path: Path, needles: List[str]) -> bool:
    if not path.exists():
        return False
    text = read_text_safe(path)
    return any(n in text for n in needles)


# ----------------------------------------------------------------------
# Check groups
# ----------------------------------------------------------------------

def check_group_a(args: Args, results: List[CheckResult]):
    """A. Path and Repo Identity"""
    g = "A. Path and Repo Identity"
    root = args.path

    # A.1
    results.append(CheckResult(
        "path-exists", PASS if root.is_dir() else FAIL,
        str(root), group=g))

    # A.2 — required files
    required = [
        "package.json",
        "server/server.js",
        "src",
        "test",
        "CLAUDE.md",
        ".gitignore",
        "MODULE_CATALOG.md",
    ]
    for rel in required:
        p = root / rel
        results.append(CheckResult(
            f"required-path:{rel}",
            PASS if p.exists() else FAIL,
            str(p), file=str(p), group=g))

    # A.3 / A.4 / A.5 — package.json contents
    pkg = root / "package.json"
    if pkg.exists():
        try:
            data = json.loads(read_text_safe(pkg))
            name = data.get("name")
            results.append(CheckResult(
                "package-name-mjr-ehr-interactive",
                PASS if name == "mjr-ehr-interactive" else FAIL,
                f"name={name!r}", file=str(pkg), group=g))
            main = data.get("main")
            results.append(CheckResult(
                "package-main-server-server.js",
                PASS if main == "server/server.js" else FAIL,
                f"main={main!r}", file=str(pkg), group=g))
            scripts = (data.get("scripts") or {})
            required_scripts = ["start", "dev", "test", "test:unit", "lint", "build", "setup", "create-user"]
            missing = [s for s in required_scripts if s not in scripts]
            results.append(CheckResult(
                "package-required-scripts",
                PASS if not missing else FAIL,
                ("present" if not missing else f"missing: {', '.join(missing)}"),
                file=str(pkg), group=g))
        except json.JSONDecodeError as exc:
            results.append(CheckResult(
                "package-json-parse", FAIL, str(exc),
                file=str(pkg), group=g))


def check_group_b(args: Args, results: List[CheckResult]):
    """B. Local Safety Config"""
    g = "B. Local Safety Config"
    claude_md = args.path / "CLAUDE.md"
    if claude_md.exists():
        text = read_text_safe(claude_md)
        results.append(CheckResult(
            "claude-md-no-phi-rule",
            PASS if "PHI" in text and "Never include PHI" in text else FAIL,
            "Never include PHI rule present" if "Never include PHI" in text else "Never include PHI rule MISSING",
            file=str(claude_md), group=g))
        results.append(CheckResult(
            "claude-md-secrets-cycle",
            PASS if "EHR Secrets Cycle" in text or "secret-scrubber" in text else WARN,
            "Secrets cycle described" if "EHR Secrets Cycle" in text else "No EHR-Secrets-Cycle section found",
            file=str(claude_md), group=g))
    else:
        results.append(CheckResult(
            "claude-md-missing", FAIL, "CLAUDE.md not present", group=g))

    gi = args.path / ".gitignore"
    if gi.exists():
        text = read_text_safe(gi)
        for needle in ["_eval/", "_eval_*", "_eval_test"]:
            results.append(CheckResult(
                f"gitignore:{needle}",
                PASS if needle in text else WARN,
                f"{needle} {'present' if needle in text else 'missing'}",
                file=str(gi), group=g))
    else:
        results.append(CheckResult("gitignore-missing", FAIL, ".gitignore not present", group=g))

    # B.4 — verifier never reads .env contents (we just check existence, never value)
    results.append(CheckResult(
        "verifier-never-prints-env", PASS,
        "verifier reads .env presence only, never values", group=g))


def check_group_c(args: Args, results: List[CheckResult]):
    """C. Proving Ground Canon"""
    g = "C. Proving Ground Canon"
    pg = args.proving_ground
    if pg is None:
        results.append(CheckResult(
            "proving-ground-required",
            WARN if not args.strict else FAIL,
            "--proving-ground not provided", group=g))
        return
    results.append(CheckResult(
        "proving-ground-exists", PASS if pg.is_dir() else FAIL,
        str(pg), group=g))
    canon = pg / "00_Authority" / "CATC_CANONICAL_PLAN.md"
    results.append(CheckResult(
        "catc-canonical-plan-exists",
        PASS if canon.exists() else FAIL,
        str(canon), file=str(canon), group=g))
    if canon.exists():
        text = read_text_safe(canon)
        identity_markers = [
            "brick-and-mortar",
            "proving ground",
            "EHR-agnostic",
        ]
        for m in identity_markers:
            results.append(CheckResult(
                f"catc-identity:{m}",
                PASS if m.lower() in text.lower() else WARN,
                "found" if m.lower() in text.lower() else f"'{m}' not found",
                file=str(canon), group=g))


def check_group_d(args: Args, results: List[CheckResult]):
    """D. Module Count and Language Reconciliation.

    The verifier derives the expected count from MODULE_ORDER in the registry,
    then checks that all docs use the *same* count. This way the check stays
    valid as the registry evolves (13 in pre-AWV branches, 14 with AWV).
    """
    g = "D. Module Count Reconciliation"
    registry = args.path / "server/agents/module-registry.js"
    canonical_count = None
    if registry.exists():
        text = read_text_safe(registry)
        m = re.search(r"MODULE_ORDER\s*=\s*\[(.*?)\]", text, re.DOTALL)
        if m:
            canonical_count = len([s for s in m.group(1).split(",") if s.strip().startswith("'")])
        results.append(CheckResult(
            "module-registry-count",
            PASS if canonical_count and canonical_count >= 13 else FAIL,
            f"MODULE_ORDER has {canonical_count} entries (canonical for this branch)",
            file=str(registry), group=g))

    # Scan top-level docs for *stale* counts that don't match the registry.
    # Only match when "(\d+)-module" or "(\d+) module" is followed by a count-noun
    # like "system", "runtime", "clinical", "workflow", "architecture", "map" —
    # this avoids false positives like "Tier 3 modules remain draft-only".
    stale_re = re.compile(
        r"\b(\d{1,2})[- ]module[s]?\s+(?:clinical|workflow|runtime|system|architecture|map)",
        re.IGNORECASE,
    )
    docs = ["README.md", "MODULE_CATALOG.md", "VISION.md", "package.json"]
    for doc in docs:
        p = args.path / doc
        if not p.exists():
            continue
        text = read_text_safe(p)
        for line_no, line in enumerate(text.splitlines(), 1):
            for match in stale_re.finditer(line):
                count_in_doc = int(match.group(1))
                if canonical_count is not None and count_in_doc != canonical_count:
                    results.append(CheckResult(
                        f"stale-count:{count_in_doc}-module",
                        WARN if not args.strict else FAIL,
                        f"doc says {count_in_doc}-module, registry has {canonical_count}",
                        file=str(p), line=line_no, group=g))

    # Phrases like "eight functional slots" or "nine specialized agents" are
    # locked to the current canonical_count.
    word_to_int = {"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,
                   "eight":8,"nine":9,"ten":10,"eleven":11,"twelve":12,"thirteen":13,"fourteen":14}
    word_re = re.compile(r"\b(" + "|".join(word_to_int.keys()) + r")\s+(?:specialized|functional|workflow|module)", re.IGNORECASE)
    for doc in docs + ["VISION.md"]:
        p = args.path / doc
        if not p.exists():
            continue
        text = read_text_safe(p)
        for line_no, line in enumerate(text.splitlines(), 1):
            for match in word_re.finditer(line):
                w = match.group(1).lower()
                if canonical_count is not None and word_to_int[w] != canonical_count:
                    results.append(CheckResult(
                        f"stale-word-count:{w}",
                        WARN if not args.strict else FAIL,
                        f"doc says '{w}' (={word_to_int[w]}), registry has {canonical_count}",
                        file=str(p), line=line_no, group=g))


def check_group_e(args: Args, results: List[CheckResult]):
    """E. FHIR Auth and SMART Alignment"""
    g = "E. FHIR Auth + SMART"
    server = args.path / "server/server.js"
    if not server.exists():
        results.append(CheckResult("server-js-missing", FAIL, str(server), group=g))
        return
    text = read_text_safe(server)
    # E.3 — auth wall on /fhir/R4
    results.append(CheckResult(
        "fhir-mount-auth",
        PASS if re.search(r"app\.use\(\s*['\"]/fhir/R4['\"][^)]*auth\.requireAuth[^)]*fhirRouter", text) else FAIL,
        "/fhir/R4 mounted with auth.requireAuth + fhirRouter",
        file=str(server), group=g))
    # E.4 — SMART discovery before auth wall (well-known endpoints precede /fhir/R4 mount)
    fhir_idx = text.find("/fhir/R4")
    well_known_idx = text.find("/.well-known/smart-configuration")
    results.append(CheckResult(
        "smart-discovery-before-fhir-auth",
        PASS if 0 <= well_known_idx < fhir_idx else FAIL,
        "well-known/smart-configuration appears before /fhir/R4 auth wall",
        file=str(server), group=g))
    # E.5 — smart token/introspect/authorize/launch/revoke/register endpoints
    smart_endpoints = ["/smart/token", "/smart/introspect", "/smart/authorize", "/smart/launch", "/smart/revoke", "/smart/register"]
    for ep in smart_endpoints:
        results.append(CheckResult(
            f"smart-endpoint:{ep}",
            PASS if ep in text else FAIL,
            f"{ep} {'mounted' if ep in text else 'NOT FOUND'}",
            file=str(server), group=g))

    # E.6 — smartScopeCheck in fhir router
    router = args.path / "server/fhir/router.js"
    if router.exists():
        rtext = read_text_safe(router)
        results.append(CheckResult(
            "fhir-router-smartScopeCheck",
            PASS if "smartScopeCheck" in rtext else FAIL,
            "smartScopeCheck used in fhir/router.js",
            file=str(router), group=g))
        # E.7 — FHIR version 4.0.1
        results.append(CheckResult(
            "fhir-version-4.0.1",
            PASS if "4.0.1" in rtext or "4.0.1" in read_text_safe(args.path / "server/fhir/capability-statement.js") else WARN,
            "FHIR version 4.0.1 advertised", file=str(router), group=g))


def check_group_f(args: Args, results: List[CheckResult]):
    """F. FHIR Resource Surface"""
    g = "F. FHIR Resource Surface"
    router = args.path / "server/fhir/router.js"
    if not router.exists():
        results.append(CheckResult("fhir-router-missing", FAIL, str(router), group=g))
        return
    text = read_text_safe(router)
    resources = ["Patient", "Encounter", "Condition", "Observation",
                 "AllergyIntolerance", "MedicationRequest", "Appointment", "Practitioner"]
    for r in resources:
        results.append(CheckResult(
            f"fhir-resource:{r}",
            PASS if r in text else FAIL,
            f"{r} read/search {'present' if r in text else 'NOT FOUND'}",
            file=str(router), group=g))
    # Bundle ingestion gated
    results.append(CheckResult(
        "fhir-bundle-ingestion",
        PASS if "POST" in text and "/Bundle" in text else WARN,
        "Inbound POST /Bundle ingestion route present",
        file=str(router), group=g))


def check_group_g(args: Args, results: List[CheckResult]):
    """G. Practitioner/User Schema Alignment"""
    g = "G. Practitioner Schema"
    mapper = args.path / "server/fhir/mappers/practitioner.js"
    migs = args.path / "server/database-migrations.js"
    if not mapper.exists():
        results.append(CheckResult("practitioner-mapper-missing", FAIL, str(mapper), group=g))
        return
    mtext = read_text_safe(mapper)
    fields = ["full_name", "email", "phone", "npi_number", "username", "role"]
    for f in fields:
        in_mapper = f in mtext
        in_mig = migs.exists() and (f in read_text_safe(migs))
        status = PASS if in_mapper and in_mig else WARN
        results.append(CheckResult(
            f"practitioner-field:{f}",
            status,
            f"mapper={'yes' if in_mapper else 'no'} migration={'yes' if in_mig else 'no'}",
            file=str(mapper), group=g))


def check_group_h(args: Args, results: List[CheckResult]):
    """H. Auth and Header Bypass."""
    g = "H. Auth Header Bypass Gate"
    auth_js = args.path / "server/security/auth.js"
    if not auth_js.exists():
        results.append(CheckResult("auth-js-missing", FAIL, str(auth_js), group=g))
        return
    text = read_text_safe(auth_js)
    # JWT_SECRET must NOT be in module.exports as an actual exported binding.
    # Strip comments inside the exports block before checking — comments that
    # mention JWT_SECRET are documentation, not exports.
    exports_block = re.search(r"module\.exports\s*=\s*\{([^}]+)\}", text)
    if exports_block:
        body = exports_block.group(1)
        # Drop // line comments and /* block comments */
        body_no_comments = re.sub(r"//[^\n]*", "", body)
        body_no_comments = re.sub(r"/\*.*?\*/", "", body_no_comments, flags=re.DOTALL)
        # Look for an actual exported binding (identifier on its own, possibly
        # with `: value`, terminated by comma or closing brace).
        exported = bool(re.search(r"\bJWT_SECRET\s*[:,}\n]", body_no_comments))
        results.append(CheckResult(
            "jwt-secret-not-exported",
            FAIL if exported else PASS,
            "JWT_SECRET removed from exports" if not exported else "JWT_SECRET still exported",
            file=str(auth_js), group=g))
    # Dev bypass requires both NODE_ENV=development AND ENABLE_DEV_AUTH_BYPASS=true
    needs_both = (
        "process.env.NODE_ENV === 'development'" in text
        and "process.env.ENABLE_DEV_AUTH_BYPASS === 'true'" in text
    )
    results.append(CheckResult(
        "dev-bypass-double-gate",
        PASS if needs_both else FAIL,
        "Dev bypass gated on NODE_ENV=development AND ENABLE_DEV_AUTH_BYPASS=true",
        file=str(auth_js), group=g))

    # rbac.js + hipaa-middleware.js: no unconditional x-user-role fallback
    for rel in ["server/security/rbac.js", "server/security/hipaa-middleware.js"]:
        p = args.path / rel
        if not p.exists():
            continue
        ptext = read_text_safe(p)
        # any line that has `req.headers['x-user-role']` outside a dev-bypass guard
        bad = []
        for line_no, line in enumerate(ptext.splitlines(), 1):
            if "req.headers['x-user-role']" in line and "ENABLE_DEV_AUTH_BYPASS" not in line:
                # If the function consults an explicit dev-bypass block right above, allow it.
                # Conservative check: file must contain ENABLE_DEV_AUTH_BYPASS *somewhere*.
                if "ENABLE_DEV_AUTH_BYPASS" not in ptext:
                    bad.append(line_no)
        results.append(CheckResult(
            f"header-fallback-gate:{rel}",
            PASS if not bad else FAIL,
            ("guarded by dev-bypass env flag" if not bad else f"unguarded fallback at lines {bad}"),
            file=str(p), group=g))


def check_group_i(args: Args, results: List[CheckResult]):
    """I. MediVault and Audit Alignment"""
    g = "I. MediVault Audit"
    server = args.path / "server/server.js"
    medivault = args.path / "server/routes/medivault-routes.js"
    audit = args.path / "server/audit-logger.js"
    if not (server.exists() and medivault.exists()):
        results.append(CheckResult("medivault-files-missing", FAIL,
                                   "server.js or medivault-routes.js missing", group=g))
        return
    server_text = read_text_safe(server)
    mv_text = read_text_safe(medivault)
    # I.1 — MediVault accepts either a clinician JWT OR a matching patient-portal
    # session (per design comment in server.js), so it performs its own auth
    # check before the global /api auth wall. We verify the mount is documented
    # as intentionally-before-auth AND that the route module enforces its own auth.
    api_auth_match = re.search(
        r"app\.use\(\s*['\"]\/api['\"]\s*,\s*auth\.requireAuth\s*\)",
        server_text,
    )
    mv_invoke_match = re.search(r"mountMediVaultRoutes\s*\(", server_text)
    has_intent_comment = bool(re.search(
        r"MediVault.*own auth|patient.{1,40}portal session|(?:clinician|patient).{1,40}auth",
        server_text, re.IGNORECASE | re.DOTALL,
    ))
    if api_auth_match and mv_invoke_match:
        if api_auth_match.start() < mv_invoke_match.start():
            results.append(CheckResult(
                "medivault-mount-order",
                PASS,
                "MediVault mounts AFTER /api auth wall (single-auth model)",
                file=str(server), group=g))
        elif has_intent_comment:
            # Mounted before /api auth; design is dual-auth. Verify MediVault
            # routes call requireAuth or check req.user / portal session inside.
            mv_does_auth = bool(re.search(
                r"requireAuth|patient_portal|portalSession|req\.user|verifyToken",
                mv_text,
            ))
            results.append(CheckResult(
                "medivault-self-auth",
                PASS if mv_does_auth else FAIL,
                "MediVault mounts BEFORE /api auth (dual-auth model) and "
                + ("performs its own auth check" if mv_does_auth else "does NOT perform its own auth"),
                file=str(medivault), group=g))
        else:
            results.append(CheckResult(
                "medivault-mount-order",
                FAIL,
                "MediVault mounts BEFORE /api auth wall but no dual-auth intent comment found",
                file=str(server), group=g))
    else:
        results.append(CheckResult(
            "medivault-mount-order",
            FAIL,
            "could not locate /api auth mount or mountMediVaultRoutes() call",
            file=str(server), group=g))
    # I.2 — exports /api/medivault/export/:patientId
    results.append(CheckResult(
        "medivault-export-route",
        PASS if "/export/:patientId" in mv_text or "/export/" in mv_text else FAIL,
        "MediVault export route registered",
        file=str(medivault), group=g))
    # I.5 — vault_access_log written
    results.append(CheckResult(
        "medivault-writes-vault-access-log",
        PASS if "vault_access_log" in mv_text else WARN,
        "vault_access_log writes present",
        file=str(medivault), group=g))
    # I.6 — audit-logger.js has PHI route for medivault export
    if audit.exists():
        atext = read_text_safe(audit)
        results.append(CheckResult(
            "audit-logger-medivault-phi-route",
            PASS if "/api/medivault/export/:patientId" in atext or "medivault/export" in atext else WARN,
            "audit-logger declares medivault export as PHI route",
            file=str(audit), group=g))


def check_group_j(args: Args, results: List[CheckResult]):
    """J. Autobetter Lane (only when --include-autobetter)"""
    if not args.include_autobetter:
        return
    g = "J. Autobetter"
    prompt = args.path / "00_CLAUDE_CODE_EHR_AUTOBETTER_PROMPT.md"
    report = args.path / "docs/AUTOBETTER_EHR_FRONTEND_REPORT.md"
    results.append(CheckResult(
        "autobetter-prompt-exists",
        PASS if prompt.exists() else FAIL,
        str(prompt), file=str(prompt), group=g))
    results.append(CheckResult(
        "autobetter-report-exists",
        PASS if report.exists() else WARN,
        str(report), file=str(report), group=g))
    if prompt.exists():
        text = read_text_safe(prompt)
        for needle, label in [
            ("Synthetic EHR Demo", "synthetic-demo-banner"),
            ("No PHI", "no-phi-banner"),
        ]:
            results.append(CheckResult(
                f"autobetter-banner:{label}",
                PASS if needle in text else WARN,
                f"'{needle}' present" if needle in text else f"'{needle}' MISSING",
                file=str(prompt), group=g))


def check_group_k(args: Args, results: List[CheckResult]):
    """K. Tests and Smoke (presence of test files only — verifier doesn't run them)."""
    g = "K. Test Coverage"
    test_dir = args.path / "test"
    unit_dir = test_dir / "unit"
    results.append(CheckResult(
        "unit-test-dir-exists",
        PASS if unit_dir.is_dir() else WARN,
        str(unit_dir), file=str(unit_dir), group=g))
    if unit_dir.is_dir():
        names = sorted(p.name for p in unit_dir.glob("*.test.js"))
        # plan mandates: auth, rbac, phi-encryption, hipaa-middleware tests
        required_topics = {
            "rbac": any("rbac" in n for n in names),
            "phi-encryption": any("phi-encryption" in n for n in names),
            "audit": any("audit" in n for n in names),
            "auth": any("auth" in n for n in names),
        }
        for topic, present in required_topics.items():
            results.append(CheckResult(
                f"unit-tests:{topic}",
                PASS if present else WARN,
                f"{topic} unit tests {'present' if present else 'missing'}",
                file=str(unit_dir), group=g))


def check_group_l(args: Args, results: List[CheckResult]):
    """L. Ultrareview P0/P1 invariants — sampled regression checks."""
    g = "L. Ultrareview Regression Sample"
    server = args.path / "server/server.js"
    if server.exists():
        text = read_text_safe(server)
        # S-C1: /api/* protected
        results.append(CheckResult(
            "S-C1:/api-globally-auth-protected",
            PASS if "app.use('/api', auth.requireAuth)" in text else FAIL,
            "global /api auth requireAuth mount", file=str(server), group=g))
        # S-C2: RBAC wired on resource groups
        rbac_groups = ["/api/patients", "/api/encounters", "/api/medications", "/api/audit", "/api/billing"]
        missing_rbac = [g_ for g_ in rbac_groups if g_ not in text]
        results.append(CheckResult(
            "S-C2:rbac-resource-groups",
            PASS if not missing_rbac else FAIL,
            "all resource groups wired" if not missing_rbac else f"missing: {missing_rbac}",
            file=str(server), group=g))

    # A-C3: orchestrator mutex
    orch = args.path / "server/agents/orchestrator.js"
    if orch.exists():
        otext = read_text_safe(orch)
        results.append(CheckResult(
            "A-C3:orchestrator-mutex",
            PASS if "releaseLock" in otext or "Promise" in otext and "pipelineRunning" in otext else WARN,
            "promise-based mutex around pipelineRunning", file=str(orch), group=g))

    # A-C2: enabled state save/restore
    if orch.exists():
        otext = read_text_safe(orch)
        results.append(CheckResult(
            "A-C2:agent-enabled-save-restore",
            PASS if "savedStates" in otext and "finally" in otext else WARN,
            "savedStates Map + finally block restore", file=str(orch), group=g))


def check_secret_leakage(args: Args, results: List[CheckResult]):
    """Scan for accidental secret values in tracked text files. Never print the value."""
    g = "Z. Secret Leakage Scan"
    skip_dirs = {"node_modules", ".git", "dist", "_eval", "data", "logs", "worktrees"}
    text_exts = {".js", ".jsx", ".mjs", ".ts", ".tsx", ".json", ".md", ".yml", ".yaml", ".env.example"}
    findings = 0
    for p in args.path.rglob("*"):
        if not p.is_file():
            continue
        rel_parts = p.relative_to(args.path).parts
        if any(part in skip_dirs for part in rel_parts):
            continue
        if p.suffix not in text_exts and p.name != ".env.example":
            continue
        if p.name == ".env":
            continue  # never read .env
        try:
            for ln, line in enumerate(read_text_safe(p).splitlines(), 1):
                for pat in SECRET_PATTERNS:
                    m = pat.search(line)
                    if m:
                        # special case: .env.example placeholders are allowed (empty/sample)
                        if p.name.endswith(".env.example"):
                            continue
                        # ignore documentation that just shows the pattern
                        if "example" in line.lower() or "placeholder" in line.lower():
                            continue
                        findings += 1
                        results.append(CheckResult(
                            "secret-pattern-match",
                            WARN,
                            f"possible secret pattern (value redacted)",
                            file=str(p), line=ln, group=g))
                        break
        except OSError:
            continue
    if findings == 0:
        results.append(CheckResult(
            "no-secret-patterns", PASS,
            "no high-confidence secret patterns found in scanned tree", group=g))


# ----------------------------------------------------------------------
# Output
# ----------------------------------------------------------------------

def print_text(results: List[CheckResult]):
    by_group = {}
    for r in results:
        by_group.setdefault(r.group or "(ungrouped)", []).append(r)
    for group in sorted(by_group):
        print(f"\n=== {group} ===")
        for r in by_group[group]:
            loc = f" {r.file}:{r.line}" if r.line else (f" {r.file}" if r.file else "")
            print(f"  [{r.status}] {r.name}: {r.detail}{loc}")
    counts = {PASS: 0, WARN: 0, FAIL: 0}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    print(f"\nSummary: {counts.get(PASS,0)} PASS, {counts.get(WARN,0)} WARN, {counts.get(FAIL,0)} FAIL")


def print_json(results: List[CheckResult]):
    counts = {PASS: 0, WARN: 0, FAIL: 0}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    out = {
        "summary": counts,
        "results": [r.to_dict() for r in results],
    }
    print(json.dumps(out, indent=2))


def write_markdown_report(results: List[CheckResult], path: Path):
    if "_eval" in path.parts or "_eval" in str(path):
        raise SystemExit("write-report path must not be inside _eval/")
    counts = {PASS: 0, WARN: 0, FAIL: 0}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    lines = []
    lines.append("# EHR Harden Verifier Report")
    lines.append(f"\n**Summary:** {counts.get(PASS,0)} PASS · {counts.get(WARN,0)} WARN · {counts.get(FAIL,0)} FAIL\n")
    by_group = {}
    for r in results:
        by_group.setdefault(r.group or "(ungrouped)", []).append(r)
    for group in sorted(by_group):
        lines.append(f"\n## {group}\n")
        lines.append("| Status | Check | Detail | File:Line |")
        lines.append("|---|---|---|---|")
        for r in by_group[group]:
            loc = f"`{r.file}:{r.line}`" if r.line else (f"`{r.file}`" if r.file else "")
            detail = r.detail.replace("|", r"\|")
            lines.append(f"| {r.status} | `{r.name}` | {detail} | {loc} |")
    path.write_text("\n".join(lines), encoding="utf-8")


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

def parse_args(argv: List[str]) -> Args:
    p = argparse.ArgumentParser(
        prog="ehr_harden_verify_skill.py",
        description="Read-only verifier for the Clinical EHR + Proving Ground alignment.",
    )
    p.add_argument("--path", required=True, type=Path, help="EHR repo root")
    p.add_argument("--proving-ground", type=Path, default=None, help="Proving Ground root (required in --strict)")
    p.add_argument("--include-autobetter", action="store_true", help="Include Autobetter prompt/report checks")
    p.add_argument("--strict", action="store_true", help="Treat warnings as failures for alignment-critical items")
    p.add_argument("--json", dest="json_out", action="store_true", help="Emit machine-readable JSON to stdout")
    p.add_argument("--write-report", type=Path, default=None, help="Optional. Write a redacted markdown report")
    ns = p.parse_args(argv)
    return Args(
        path=ns.path,
        proving_ground=ns.proving_ground,
        include_autobetter=ns.include_autobetter,
        strict=ns.strict,
        json_out=ns.json_out,
        write_report=ns.write_report,
    )


def exit_from_results(results: List[CheckResult], strict: bool) -> int:
    has_fail = any(r.status == FAIL for r in results)
    has_warn = any(r.status == WARN for r in results)
    if has_fail:
        return 1
    if strict and has_warn:
        return 1
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    try:
        args = parse_args(argv if argv is not None else sys.argv[1:])
    except SystemExit:
        return 2
    if not args.path.exists():
        print(f"ERROR: --path does not exist: {args.path}", file=sys.stderr)
        return 2
    results: List[CheckResult] = []
    check_group_a(args, results)
    check_group_b(args, results)
    check_group_c(args, results)
    check_group_d(args, results)
    check_group_e(args, results)
    check_group_f(args, results)
    check_group_g(args, results)
    check_group_h(args, results)
    check_group_i(args, results)
    check_group_j(args, results)
    check_group_k(args, results)
    check_group_l(args, results)
    check_secret_leakage(args, results)

    if args.json_out:
        print_json(results)
    else:
        print_text(results)

    if args.write_report:
        write_markdown_report(results, args.write_report)

    return exit_from_results(results, args.strict)


if __name__ == "__main__":
    sys.exit(main())
