# Phase 16 - Submission and Release Hardening (v1.7.0)

**Goal:** Make PR/MR submission and ongoing maintenance feel reliable, polished, and low-friction.

## Prerequisites

- Phase 15 is complete, published, and stable
- Working dir: `C:\Users\codtv\Desktop\Apps\MasonDevTools\extensions\pr-forge`
- GitHub and GitLab API access remain available for existing SCM flows

## Product bets

- **Update flow clarity** - make it obvious when an existing PR/MR is being refreshed instead of created from scratch
- **State hygiene** - keep branch/base changes and resubmits from using stale metadata
- **Recovery first** - turn edge-case failures into actionable prompts and deterministic fallback paths
- **Release truth** - keep docs, packaging, and the shipped VSIX aligned with the actual product

## Permanent architectural rules

- **No `vscode` imports in `src/scm/`** - keep provider logic unit-testable
- **SCM providers stay isolated** - GitHub and GitLab behavior belongs in `src/scm/`
- **No direct browser scraping for core data** - use official APIs first, browser automation only if a host has no API path
- **Tests go in `src/test/`** - mock network calls and keep all tests deterministic
- **README must stay honest** - supported hosts, limits, and workflows must match shipped behavior
- **Commit format:** `Phase 16 Slice N: <summary>` with the standard Co-Authored-By trailer if the team keeps using it

## Slices

### Slice 16.1 - Submission refresh and update UX

**Goal:** Make it obvious when PR Forge is updating an existing PR/MR and keep the submit flow resilient when branch state changes.

**Files in scope:**
- `src/extension.ts` - improve create/update detection, resubmit prompts, and branch/base refresh behavior
- `src/sidebarProvider.ts` - reflect submit vs update state more clearly in the sidebar
- `src/scm/github.ts` - tighten update semantics for existing pull requests
- `src/scm/gitlab.ts` - tighten update semantics for existing merge requests
- `src/test/scm.test.ts` - cover create/update transitions and stale-state recovery

**Acceptance criteria:**
1. Existing PR/MR update behavior is easy to discover from the sidebar
2. Branch or base changes clear stale assumptions before resubmit
3. Resubmit safeguards are deterministic and host-specific
4. `npm run lint`, `npm run compile`, and `npm test` all pass

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
```

---

### Slice 16.2 - Workflow polish

**Goal:** Reduce friction in common sidebar flows and improve the shape of the prompts and defaults users see.

**Files in scope:**
- `src/extension.ts` - improve setup guidance and common-path prompts
- `src/sidebarProvider.ts` - streamline sidebar ergonomics and repeated actions
- `src/config.ts` - tighten default handling if needed
- `src/test/` - cover prompt and default behavior changes

**Acceptance criteria:**
1. Setup guidance is clearer for new and returning users
2. Common actions require fewer clicks
3. Prompt text and defaults remain truthful across providers
4. `npm run lint`, `npm run compile`, and `npm test` all pass

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
```

---

### Slice 16.3 - Release hardening

**Goal:** Keep the docs, packaging, and release workflow aligned with the shipped extension state.

**Files in scope:**
- `README.md` - sync install text, workflow notes, and supported behavior
- `docs/agent-guides/current-state.md` - keep the live status snapshot current
- `package.json` - bump version and keep release metadata accurate
- `.vscodeignore` - ensure the VSIX ships only what users need
- `pr-forge-<version>.vsix` - verify the packaged artifact in the repo root

**Acceptance criteria:**
1. README and live-state docs match shipped behavior
2. VSIX packaging is reproducible and free of repo-only clutter
3. Version bump and release checks are ready before publish
4. The release path remains end to end reproducible

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
npm run package:vsix
```

---

## Phase gate

The phase is ready to close only when:

- all slices are complete and committed on the release branch
- lint, compile, and tests are green
- the README reflects the shipped submission and release behavior
- the branch is pushed to origin
- the release artifact is built for the next version
