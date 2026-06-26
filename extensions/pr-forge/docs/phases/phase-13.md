# Phase 13 - Template-Aware PRs and Metadata Automation (v1.4.0)

**Goal:** Make PR Forge materially better at producing and shipping high-quality pull
requests and merge requests by learning repository templates, surfacing metadata controls,
and closing the last meaningful GitLab parity gaps.

## Prerequisites

- Phase 12 is complete and green on `phase-12/multi-scm`
- Working dir: `C:\Users\codtv\Desktop\Apps\MasonDevTools\extensions\pr-forge`
- `VSCE_PAT` must be available for the final release slice if Marketplace publish is
  expected

## Implementation status

- Slice 13.1 complete
- Slice 13.2 complete
- Slice 13.3 complete
- Slice 13.4 complete

## Product bets

- **Template-aware generation** - respect repository PR/MR templates so generated drafts
  match the project's own structure instead of inventing one
- **Metadata automation** - let submit flows carry labels, assignees, reviewers, and
  milestone-style metadata where the host supports it
- **GitLab parity** - improve GitLab review threading so it behaves more like GitHub
  review comments instead of plain notes where the API permits it
- **Release quality** - keep the README, changelog, packaged VSIX, and live status doc in
  lockstep with the shipped behavior

## Permanent architectural rules

- **No `vscode` imports in `src/scm/` or `src/prGenerator.ts`** - keep core logic
  unit-testable
- **SCM providers live in `src/scm/`** - provider-specific API work stays in isolated files
- **No `execSync` in `src/scm/`** - use HTTP(S) clients only
- **Tests go in `src/test/`** - keep network interactions mocked and self-contained
- **README must match shipped behavior** - supported hosts, limitations, and install
  instructions should not drift from the code
- **Commit message format:** `Phase 13 Slice N: <summary>` ending with the
  Co-Authored-By trailer

## Slices

### Slice 1 - Template-aware PR body generation

**Goal:** Detect repo-local PR/MR templates and feed them into both AI and no-AI draft
generation so the first draft matches the repository's own contribution conventions.

**Files in scope:**
- `src/prGenerator.ts` - load template content and include it in the generation prompt and
  template output
- `src/extension.ts` - detect template files during config initialization
- `src/config.ts` - add config fields for template paths/content if needed
- `src/test/prGenerator.test.ts` - cover template discovery and template-aware generation
- `src/test/config.test.ts` - cover schema migration for any new config fields

**Acceptance criteria:**
1. GitHub PR templates are discovered from the repository and used when present
2. GitLab merge request templates are discovered from the repository and used when present
3. The no-AI template body includes template-aware guidance without losing the existing
   diffstat, commits, and tests sections
4. `npm run lint`, `npm run compile`, and `npm test` all pass

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
```

---

### Slice 2 - Metadata-aware submission

**Goal:** Let users ship review-ready PRs/MRs with labels, reviewers, assignees, and
milestone-style metadata instead of only title/body content.

**Files in scope:**
- `src/config.ts` - add metadata config fields and migrate them safely
- `src/extension.ts` - surface metadata settings and pass them into submit flows
- `src/scm/github.ts` - add post-create metadata calls using GitHub REST APIs
- `src/scm/gitlab.ts` - add the matching GitLab metadata calls where the API supports them
- `src/test/scm.test.ts` - cover metadata round trips and error handling

**Acceptance criteria:**
1. GitHub submissions can attach labels and requested reviewers
2. GitLab submissions can attach labels and the supported merge-request metadata
3. Missing or unsupported metadata never blocks a PR/MR from being created
4. `npm run lint`, `npm run compile`, and `npm test` all pass

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
```

---

### Slice 3 - GitLab review parity

**Goal:** Improve GitLab review posting so inline feedback uses real discussion threads when
the API provides enough context, with a predictable fallback when it does not.

**Files in scope:**
- `src/scm/gitlab.ts` - implement discussion-thread posting with positional anchoring
- `src/reviewComments.ts` - adapt mapping or fallback behavior if needed
- `src/test/scm.test.ts` - cover anchored and fallback review posting paths

**Acceptance criteria:**
1. GitLab inline reviews use discussion threads when positional data is available
2. The fallback remains a comment-based review path when threading cannot be anchored
3. Review posting failures remain actionable and do not silently drop findings
4. `npm run lint`, `npm run compile`, and `npm test` all pass

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
```

---

### Slice 4 - Hardening, docs, packaging, publish

**Goal:** Align README, changelog, current-state docs, VSIX packaging, and Marketplace
publish behavior with the shipped 1.4.0 feature set.

**Files in scope:**
- `README.md`
- `CHANGELOG.md`
- `docs/agent-guides/current-state.md`
- `.vscodeignore`
- `package.json`
- `pr-forge-1.4.0.vsix`

**Acceptance criteria:**
1. README reflects the shipped hosts and the new template/metadata features
2. The packaged VSIX excludes repo-only scaffolding and stays installable
3. `node scripts/release.mjs 1.4.0` produces `pr-forge-1.4.0.vsix`
4. `VSCE_PAT` gates publish cleanly: publish runs if present and stops with a clear
   manual step if absent
5. The branch is pushed to origin before the phase closes

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
node scripts/release.mjs 1.4.0
```

---

## Phase gate

The phase is ready to close only when:

- all slices are complete and committed on `phase-13/template-metadata`
- lint, compile, and tests are green
- the VSIX exists and reflects the final release state
- README and changelog match the shipped behavior
- the branch is pushed to origin
- Marketplace publish is completed if `VSCE_PAT` was available

Phase 13 is complete.
