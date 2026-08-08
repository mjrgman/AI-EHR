#!/usr/bin/env python3
"""PHI-oriented scan for the Clinical/EHR repo.

Scans git-tracked files for the HIPAA-style identifier classes. Reports
file:line and a redacted fingerprint only -- never the matched value.
Purpose is to distinguish synthetic demo fixtures from real patient data.
"""
import hashlib
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(r"C:\Users\micha\files\A_active_projects\Clinical\EHR")

PATTERNS = {
    # 3-2-4 SSN, excluding all-zero / 000-/ 666- / 9xx- invalid ranges is not
    # worth it here: we want every candidate surfaced.
    "ssn": re.compile(r"\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b"),
    "phone_us": re.compile(r"(?<![\d.])(?:\+1[-. ]?)?\(?\b[2-9]\d{2}\)?[-. ]\d{3}[-. ]\d{4}\b(?![\d.])"),
    "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    "dob_iso": re.compile(r"\b(?:19[2-9]\d|200\d|201\d)-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b"),
    "dob_us": re.compile(r"\b(?:0[1-9]|1[0-2])/(?:0[1-9]|[12]\d|3[01])/(?:19[2-9]\d|20[01]\d)\b"),
    "mrn": re.compile(r"\bMRN[-:\s#]*([A-Z0-9-]{4,20})\b", re.I),
    # Member/subscriber/policy/group identifiers
    "insurance_id": re.compile(
        r"\b(?:member|subscriber|policy|group|payer|insurance)[_\s-]?(?:id|no|number|#)[\"'\s:=]+([A-Z0-9-]{5,20})",
        re.I,
    ),
    "npi": re.compile(r"\bNPI[-:\s#]*(\d{10})\b", re.I),
    "us_street": re.compile(
        r"\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+"
        r"(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b"
    ),
    "credit_card": re.compile(r"\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b"),
}

# Emails that are structurally incapable of being real patient contact info.
EMAIL_SAFE = re.compile(
    r"@(?:example\.(?:com|org|net)|test\.com|localhost|clinic\.test|"
    r"mjrhealth\.(?:com|test)|demo\.(?:com|local)|.*\.invalid|.*\.local|"
    r"sentry\.io|npmjs\.com|github\.com|w3\.org|hl7\.org|reactjs\.org)",
    re.I,
)

# Files where identifier-shaped strings are expected as schema/format, not data.
SCHEMA_HINT = re.compile(r"(migration|schema|mapper|validator|regex|pattern|\.test\.|test/|docs/|\.md$)", re.I)

BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf",
              ".pdf", ".zip", ".db", ".db-wal", ".db-shm", ".bundle"}


def tracked_files():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True)
    return [line.strip() for line in out.stdout.splitlines() if line.strip()]


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]


def redact(value: str) -> str:
    """Shape-preserving redaction: never emit the literal value."""
    if len(value) <= 4:
        return "*" * len(value)
    return f"{value[0]}{'*' * (len(value) - 2)}{value[-1]} [len={len(value)} fp={fingerprint(value)}]"


def main():
    findings = defaultdict(list)
    scanned = 0
    for rel in tracked_files():
        path = ROOT / rel
        if path.suffix.lower() in BINARY_EXT or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        scanned += 1
        for lineno, line in enumerate(text.splitlines(), 1):
            if len(line) > 2000:  # minified/bundled
                continue
            for name, pat in PATTERNS.items():
                for m in pat.finditer(line):
                    value = m.group(1) if m.groups() else m.group(0)
                    if name == "email" and EMAIL_SAFE.search(value):
                        continue
                    findings[name].append((rel, lineno, redact(value)))

    print(f"PHI SCAN -- {scanned} git-tracked text files scanned\n")
    total = sum(len(v) for v in findings.values())
    if not total:
        print("No matches in any identifier class.")
        return 0

    print(f"{'CLASS':<16} {'COUNT':>6}  DISTINCT FILES")
    print("-" * 60)
    for name in sorted(findings, key=lambda k: -len(findings[k])):
        files = {f for f, _, _ in findings[name]}
        print(f"{name:<16} {len(findings[name]):>6}  {len(files)}")

    print("\n\nDETAIL (values redacted; fp = sha256 prefix)\n")
    for name in sorted(findings, key=lambda k: -len(findings[k])):
        print(f"### {name}  ({len(findings[name])} matches)")
        by_file = defaultdict(list)
        for f, ln, red in findings[name]:
            by_file[f].append((ln, red))
        for f in sorted(by_file):
            flag = "  [schema/test context]" if SCHEMA_HINT.search(f) else ""
            print(f"  {f}  x{len(by_file[f])}{flag}")
            for ln, red in by_file[f][:3]:
                print(f"      L{ln}: {red}")
            if len(by_file[f]) > 3:
                print(f"      ... {len(by_file[f]) - 3} more")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
