# Phase 12 — Multi-SCM Overhaul (v1.3.0)

**Goal:** Ship GitLab Merge Request support (the #1 advertised "planned" feature), finish the
no-API-key template path, and harden the release for v1.3.0. Extension currently at v1.2.3 on
master; target is v1.3.0 on a dedicated branch `phase-12/multi-scm`.

## Prerequisites

- master is green: `npm run lint` + `npm run compile` + `npm test` all pass (fix WIP first in Slice 1)
- `VSCE_PAT` env var must be set for Slice 6 to publish; if absent Slice 6 stops before publish and reports
- Working dir: `C:\Users\codtv\Desktop\Apps\MasonDevTools\extensions\pr-forge`

## Permanent architectural rules

- **No `vscode` imports in `src/scm/` or `src/prGenerator.ts`** — these modules are unit-testable without a VS Code host
- **SCM providers live in `src/scm/`** — each provider is its own file; `src/scm/index.ts` exports the interface and `parseRemote`
- **No `execSync` in `src/scm/`** — use `https`/`http` only (same pattern as `github.ts`)
- **`prefer-const` enforced** — zero lint errors before any slice is committed
- **Tests go in `src/test/`** — Mocha + ts-node, no vscode host needed for SCM/prGenerator tests
- **Commit message format:** `Phase 12 Slice N: <summary>` ending with Co-Authored-By trailer

## Slices

### Slice 1 — Fix lint + complete no-key path

**Goal:** Clean up the uncommitted WIP so master-equivalent state is green before branching.

**Files in scope:**
- `src/prGenerator.ts` — fix 2 `prefer-const` lint errors (lines 164 & 385)
- `src/test/prGenerator.test.ts` — add tests for `generatePrBodyTemplate`
- Commit the WIP (`src/extension.ts` + `src/prGenerator.ts`)

**Acceptance criteria:**
1. `npm run lint` exits 0
2. `npm run compile` exits 0
3. `npm test` passes ≥52 tests (adds ≥3 for `generatePrBodyTemplate`)
4. `generatePrBodyTemplate` is tested for: branch-name→title derivation, no-AI output shape (has `## Summary`, `## Changes`, `## Commits`), and graceful handling of no commits

**Verification commands:**
```
npm run lint
npm run compile
npm test
```

---

### Slice 2 — GitLab PAT auth & `parseRemote` routing

**Goal:** Let `parseRemote` recognise `gitlab.com` (HTTPS + SSH) remotes and return a `GitLabScmProvider`.
Separate from the full implementation — just routing + auth token plumbing.

**Files in scope:**
- `src/scm/index.ts` — extend `parseRemote` to match `gitlab.com` HTTPS and SSH patterns; return a `GitLabScmProvider` stub (not yet implemented)
- `src/scm/gitlab.ts` — add a constructor that accepts a `token` and stores it; other methods remain throwing stubs
- `src/extension.ts` — remove the hardcoded "GitHub only" error messages for GitLab remotes (lines 774-780, 934-943, 1031-1034 pattern); the submit flow already reaches `parseRemote`, let the stub throw naturally until Slice 3

**Acceptance criteria:**
1. `parseRemote('https://gitlab.com/owner/repo.git', tok)` returns `{ owner: 'owner', repo: 'repo', provider: GitLabScmProvider }`
2. `parseRemote('git@gitlab.com:owner/repo.git', tok)` returns the same shape
3. `parseRemote` still returns null for non-GitHub/non-GitLab URLs
4. `npm run lint` exits 0, `npm run compile` exits 0, `npm test` ≥52 passing
5. New tests in `src/test/scm.test.ts` cover the two GitLab patterns and the unknown-remote null case

**Verification commands:**
```
npm run lint
npm run compile
npm test
```

---

### Slice 3 — GitLab MR provider: create, find, update, comment

**Goal:** Implement `GitLabScmProvider` to create, find, and update Merge Requests, and post plain comments — using the GitLab REST API v4.

**Files in scope:**
- `src/scm/gitlab.ts` — full implementation of `createPr`, `findOpenPr`, `updatePr`, `postPrComment`
- Leave `createReview` throwing (line-anchored inline review on GitLab is Slice 4's task)

**Key GitLab API mappings (use `https://gitlab.com/api/v4`):**
- Create MR: `POST /projects/:id/merge_requests` — `id` = `encodeURIComponent('owner/repo')`
- Find open MR: `GET /projects/:id/merge_requests?state=opened&source_branch=:head&per_page=1`
- Update MR: `PUT /projects/:id/merge_requests/:iid`
- Post comment: `POST /projects/:id/merge_requests/:iid/notes`
- Auth header: `Authorization: Bearer <token>`
- `PrResult.url` = `web_url` from response; `PrResult.number` = `iid` (not `id`)

**Error handling:**
- 401 → "Bad credentials — check your GitLab personal access token (api scope required)"
- 403 → "Forbidden — token lacks api scope or you hit a rate limit"
- 404 → "Not found — project does not exist or token cannot access it"
- 422 → "Unprocessable — no commits between source and target branch, or MR already exists"

**Acceptance criteria:**
1. `npm run compile` exits 0
2. `npm run lint` exits 0
3. Unit tests in `src/test/scm.test.ts` cover: createPr success, createPr 422 error message shape, findOpenPr returns null when empty, updatePr success shape (all using sinon/stub or inline mock of `https.request` — keep tests self-contained with no real network calls)
4. `npm test` ≥55 passing

**Verification commands:**
```
npm run lint
npm run compile
npm test
```

---

### Slice 4 — GitLab inline review + full submit wiring

**Goal:** Implement `createReview` for GitLab (as discussion notes on the MR diff), wire the
`provider` field into the sidebar UI label, and confirm end-to-end compile.

**Files in scope:**
- `src/scm/gitlab.ts` — implement `createReview` using GitLab's MR discussions API:
  `POST /projects/:id/merge_requests/:iid/discussions` with `position` body for diff anchoring.
  Fallback to a plain comment if position anchoring returns 422.
- `src/sidebarProvider.ts` — update any "GitHub" hardcoded strings in submit-related UI copy to use the provider name dynamically (search for literal "GitHub" in button labels / status messages)
- `src/extension.ts` — update all three auth/submit blocks to support GitLab PAT:
  - If remote is GitLab, skip VS Code `authentication.getSession('github', ...)` (that only works for GitHub); instead read a stored GitLab PAT via `getApiKey(context, 'gitlab')` (add `gitlab` as a provider to `secretsManager`/`llmClient.ts` if not present)
  - Show a clear error if no GitLab PAT is stored: "PR Forge: No GitLab token. Use 'Set API Key' → GitLab."
- `src/llmClient.ts` — add `gitlab` key to `PROVIDERS` constant so the existing `promptSetApiKey` flow can store a GitLab PAT (not an AI provider, but reuses the same secure storage mechanism); mark `noAuth: false`

**Acceptance criteria:**
1. `npm run lint` exits 0
2. `npm run compile` exits 0
3. `npm test` ≥55 passing
4. `createReview` on GitLab either posts per-line discussion notes or falls back to a single comment — no unhandled throws
5. The submit command no longer attempts `getSession('github', ...)` when the remote is GitLab

**Verification commands:**
```
npm run lint
npm run compile
npm test
```

---

### Slice 5 — Hardening, test expansion, config schema bump

**Goal:** Add edge-case tests, harden error paths, bump config schema to v6 (adds no new fields —
this is a "seal" bump to record the v1.3.0 schema state), and update `config.ts`.

**Files in scope:**
- `src/test/scm.test.ts` — expand to ≥20 tests covering GitLab round-trips, error messages, and `parseRemote` edge cases
- `src/test/prGenerator.test.ts` — add tests for `titleFromBranch` edge cases (no-prefix branch, multi-separator)
- `src/config.ts` — bump `schemaVersion` to 6 in `migrateConfig` (no new fields; just seal)
- `src/test/config.test.ts` — add a test that `migrateConfig({})` produces `schemaVersion: 6`

**Acceptance criteria:**
1. `npm run lint` exits 0
2. `npm run compile` exits 0
3. `npm test` ≥62 passing
4. All GitLab error paths have test coverage (401, 404, 422)
5. `migrateConfig({schemaVersion: 5})` returns `schemaVersion: 6`

**Verification commands:**
```
npm run lint
npm run compile
npm test
```

---

### Slice 6 — Version bump, docs, VSIX packaging, publish

**Goal:** Bump to v1.3.0, update CHANGELOG and README, build + package the VSIX, publish to
Marketplace, push to GitHub. This is the release slice.

**Files in scope:**
- `package.json` — version `1.2.3` → `1.3.0`
- `CHANGELOG.md` — prepend the v1.3.0 entry (GitLab MR support, no-key template path)
- `README.md` — update "GitHub only" limitation notice; add GitLab to supported submission targets; update version badge references if any
- VSIX artifact: run `node scripts/release.mjs 1.3.0` (bumps package.json, rebuilds, packages)
- Publish: `npx vsce publish --no-dependencies` (requires `VSCE_PAT` in env)
- Git: commit all changes, push `phase-12/multi-scm` branch to origin

**CHANGELOG v1.3.0 entry to prepend:**
```md
## 1.3.0

### Added
- **GitLab Merge Request support** — create, update, comment, and post inline reviews on GitLab MRs. Set a GitLab personal access token via "Set API Key" → GitLab (api scope required). Inline review falls back to a single MR comment if line anchoring is unavailable.
- **No-API-key PR body template** — when no AI key is configured, "Generate PR Body" produces a structured template (branch name, diffstat, changed-files table, commits table) you can fill in manually.
```

**Acceptance criteria:**
1. `npm run lint` exits 0, `npm run compile` exits 0, `npm test` all pass
2. `node scripts/release.mjs 1.3.0` exits 0 and produces `pr-forge-1.3.0.vsix` in the repo root
3. CHANGELOG has a `## 1.3.0` section at the top with the above content
4. README no longer says "GitHub only" without qualification
5. If `VSCE_PAT` is set: `npx vsce publish --no-dependencies` exits 0 (Marketplace publish)
6. `git push origin phase-12/multi-scm` succeeds
7. If `VSCE_PAT` is absent: STOP before publish, report VSIX path and `npx vsce publish --no-dependencies` command for the developer to run manually

**Verification commands:**
```
npm run lint
npm run compile
npm test
node scripts/release.mjs 1.3.0
```

---

## Phase gate (after Slice 6)

Auditor checks:
- All 6 slices committed and green on `phase-12/multi-scm`
- Zero lint errors
- Zero compile errors
- All tests pass
- VSIX artifact exists: `pr-forge-1.3.0.vsix`
- CHANGELOG has v1.3.0 entry
- If published: Marketplace shows v1.3.0
- `phase-12/multi-scm` pushed to origin; developer notified to open PR into master
