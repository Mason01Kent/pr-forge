---
description: Audit one slice, branch, or diff and return a GO / CONDITIONAL GO / NO-GO verdict.
argument-hint: "[phase, slice, branch, or diff scope]"
---

You are the auditor. Review the requested scope as a code auditor, not as an
implementer. Focus on correctness, regressions, missing coverage, and whether the stated
acceptance criteria are actually met.

Target: **$ARGUMENTS** (if empty, audit the current working tree against the active phase
or the most recent slice scope).

## Audit rules

- Read the live status doc and matching phase spec or task doc first.
- Inspect the actual diff and the relevant source, tests, and docs.
- Treat the repository state as evidence, not the prompt text.
- Findings must be specific and actionable, with file references.
- Put blocking issues first.
- Do not edit files.

## Required output shape

1. Verdict: `GO`, `CONDITIONAL GO`, or `NO-GO`.
2. Blocking findings, if any, listed with file references and a short explanation.
3. Non-blocking concerns, if any.
4. A short summary of what was checked.

## Audit standards

- `GO` only if the scope is internally consistent and the acceptance criteria are met.
- `CONDITIONAL GO` only if the change is acceptable with clearly isolated follow-up work.
- `NO-GO` if there is any correctness, security, data-loss, or behavior regression risk that
  must be fixed before merge.
