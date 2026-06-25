---
description: Orchestrate an entire project phase - loop every remaining slice (implement -> audit -> commit), pass the gate, then roll into the next phase and repeat.
argument-hint: "[phase, e.g. '10' or 'Phase 11' - omit for the current active phase]"
---

You are the orchestrator. Run this session on Opus. Drive a full project phase: loop
through every remaining slice in serial order, then pass the phase gate, then roll into the
next phase and repeat. You do the orchestration yourself; you delegate only implementation
and audit to subagents.

Target phase: **$ARGUMENTS** (if empty, determine the active phase from the project's
current-state or planning doc).

## Model tiering - the main cost/quality failure mode

Subagent frontmatter `model:` is unreliable here; a subagent silently inherits the parent
model unless you pass `model:` explicitly on the Agent call. So:

- Keep this orchestrator on **Opus**.
- Invoke the implementer with explicit `model: sonnet` on every Agent call.
- Invoke the auditor with explicit `model: opus`.

"Opus for orchestration and audit, Sonnet for all implementation agents." Scope the model
to each call - never let the implementer run as Opus just because the session is Opus.

## STEP 0 - Reconcile the slice list (mandatory hard gate)

Before any work, build the authoritative remaining-slice list:

1. Read the project's live status doc (e.g. `docs/agent-guides/current-state.md` or
   equivalent) to see which slices are already complete.
2. Read the phase spec (e.g. `docs/phases/` or equivalent) for the serial chain and each
   slice's acceptance criteria.
3. Cross-check the two. **If they disagree on slice numbering, what is done, or where the
   gate is - STOP and report the conflict. Do not guess.**
4. Produce the ordered list of remaining slices and confirm it with a one-line summary
   before starting the loop.

## Per-slice loop (repeat for each remaining slice, in serial order)

1. **Generate the implementation prompt** from the slice spec: goal, exact acceptance
   criteria, files/areas in scope, any permanent architectural rules for this project,
   required tests, and the verification commands. Keep it scoped to this one slice.

2. **Implement.** Invoke the implementer subagent with that prompt and `model: sonnet`.

3. **Audit.** Invoke the auditor subagent with `model: opus`, pointing at the slice spec
   and the implementer's report. It returns a short verdict (GO / CONDITIONAL GO / NO-GO)
   and a numbered list of blocking findings.

4. **Loop on findings.** If NO-GO, or CONDITIONAL GO with blocking findings, send the
   numbered `file:line - issue` list back to the implementer (model: sonnet) and re-audit.
   **Cap at 3 implement->audit cycles per slice.**

5. **HARD STOP conditions** (halt the entire run, commit nothing past the last green slice,
   report outstanding blockers):
   - a slice is still not clean after 3 cycles;
   - a change requires an architecture-level decision outside the slice's scope;
   - an auth, security, or data-integrity change the auditor flags as needing stronger review;
   - any STEP 0 reconciliation conflict.

6. **On clean GO:**
   - Update the project's live status doc (slice status + today's date).
   - **Commit this slice.** If on `main`, branch first. Message: `Phase X Slice Y: <summary>`
     ending with the Co-Authored-By trailer. (Checkpoint per slice so any later hard stop
     leaves a clean rollback point.)
   - Advance to the next slice.

## Gate slice (final slice of the phase)

The last slice is a **gate audit**, not implementation. Do NOT invoke the implementer.
Invoke the auditor (model: opus) to run the full phase gate per the spec. It writes a gate
report and returns a GO / CONDITIONAL GO / NO-GO.

- **NO-GO at the gate:** STOP and report. Do not advance to the next phase.
- **GO (or documented CONDITIONAL GO):** update the live status doc to mark the phase
  complete, commit, then continue to the next phase below.

## Roll into the next phase

After a GO gate:

1. Determine the next phase from the live status doc's "next recommended work" and the
   phase spec files.
2. Confirm its gate/prerequisites are satisfied (each phase spec should have a prerequisites
   section). **If a prerequisite is unmet, STOP and report** - do not force entry.
3. If clear, restate the new target phase in one line and re-run from STEP 0 for it.
4. **Branch policy:** unless the project's conventions say otherwise, do not create a branch
   per slice. A new phase may warrant a new branch - if unsure, STOP and ask rather than
   inventing a branching scheme.

## NEVER merge to main autonomously (hard rule)

This loop never merges, fast-forwards, rebases onto, pushes to, or opens-and-merges a PR
into `main` - under any circumstances, including a GO gate. Slice checkpoint commits land on
the working/phase branch only. Integration into `main` is the developer's manual decision.
If the loop reaches a point where merging would be the next step, STOP and report that the
branch is ready for review and merge. Do not `git merge`, `git push origin main`, or
`gh pr merge` as part of any automated run.

## Permissions / hands-off

Subagents cannot show interactive permission prompts - a call matching an `ask` rule is
treated as denied. A full multi-slice, multi-phase run does many subagent writes and several
commits, so unattended operation needs `acceptEdits` (or a sandboxed
`--dangerously-skip-permissions`) and commit authorization. If a subagent write or a commit
is denied, fall back to performing it yourself in this parent session; if you cannot, STOP
and report rather than skipping the doc update or the commit.

## Reporting

Keep chat concise. Emit a short status line as each slice passes (`Slice N: GO - <verdict>`),
and a final summary: slices completed, any hard stop and why, gate verdict(s), phases
advanced, commands run with pass/fail, `git status --short`, and confirmation that the live
status doc was updated.

The run ends when: a hard stop fires, a gate returns NO-GO, the next phase's prerequisites
are unmet, or there are no further phases defined. Report where it stopped and the single
recommended next action.
