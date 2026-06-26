# Phase 15 - Review Workflow Completion (v1.6.0)

**Goal:** Turn the review inbox/threads work from phase 14 into a fully actionable review loop.

## Prerequisites

- Phase 14 is complete, published, and stable
- Working dir: `C:\Users\codtv\Desktop\Apps\MasonDevTools\extensions\pr-forge`
- GitHub and GitLab API access remain available for existing SCM flows

## Product bets

- **Actionable review threads** - reply to review threads and comments from VS Code instead of treating them as read-only
- **Resolve state clarity** - expose resolved/unresolved state and host-specific affordances truthfully
- **Anchor-first navigation** - jump directly from the sidebar to the exact file and line anchor when the host can provide it
- **Review queue focus** - let users filter by unresolved, assigned-to-me, or recently updated review items
- **Deterministic fallback** - when the host cannot support a review action cleanly, surface the limitation instead of pretending parity

## Permanent architectural rules

- **No `vscode` imports in `src/scm/`** - keep provider logic unit-testable
- **SCM providers stay isolated** - GitHub and GitLab behavior belongs in `src/scm/`
- **No direct browser scraping for core data** - use official APIs first, browser automation only if a host has no API path
- **Tests go in `src/test/`** - mock network calls and keep all tests deterministic
- **README must stay honest** - supported hosts, limits, and workflows must match shipped behavior
- **Commit format:** `Phase 15 Slice N: <summary>` with the standard Co-Authored-By trailer if the team keeps using it

## Slices

### Slice 15.1 - Review thread actions

**Goal:** Make review threads actionable from the sidebar.

**Files in scope:**
- `src/scm/github.ts` - reply to review threads, resolve/reopen where supported, and expose thread permalinks
- `src/scm/gitlab.ts` - reply to discussions, resolve/reopen where supported, and expose discussion permalinks
- `src/extension.ts` - wire review thread actions into the command layer
- `src/sidebarProvider.ts` - add action affordances for reply, resolve, reopen, and permalink navigation
- `src/test/scm.test.ts` - cover provider-specific thread action mapping

**Acceptance criteria:**
1. Users can reply to an existing review thread or comment from VS Code
2. Users can resolve or reopen threads when the host API supports it
3. The sidebar can open the canonical thread permalink
4. `npm run lint`, `npm run compile`, and `npm test` all pass

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
```

---

### Slice 15.2 - Review navigation and filtering

**Goal:** Make the review inbox usable as a queue instead of a flat list.

**Files in scope:**
- `src/scm/github.ts` - fetch metadata needed for unresolved counts, author state, and updated timestamps
- `src/scm/gitlab.ts` - fetch the equivalent discussion metadata
- `src/extension.ts` - wire filter and sort controls into the sidebar state
- `src/sidebarProvider.ts` - add unresolved-only, recent/activity sort, and anchor navigation behavior
- `src/test/scm.test.ts` - cover sorting and filter mapping

**Acceptance criteria:**
1. The sidebar can filter to unresolved review items
2. Users can sort or focus by recent activity
3. Thread entries show the file/line anchor clearly enough to navigate without guesswork
4. `npm run lint`, `npm run compile`, and `npm test` all pass

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
```

---

### Slice 15.3 - Review state hardening

**Goal:** Make provider-specific review state and fallback behavior explicit, testable, and honest.

**Files in scope:**
- `src/scm/github.ts` - normalize resolved/unresolved/actionable mapping
- `src/scm/gitlab.ts` - normalize the equivalent GitLab discussion state
- `src/extension.ts` - surface host limitations and fallback outcomes in user-facing messages
- `src/test/scm.test.ts` - cover resolved/unresolved/actionable state mapping and fallback behavior
- `README.md` - document what users can and cannot do for each host

**Acceptance criteria:**
1. Provider-specific review edge cases are handled without silent failure
2. Resolved, unresolved, and actionable states are mapped consistently
3. The README clearly states where fallback behavior applies
4. `npm run lint`, `npm run compile`, and `npm test` all pass

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
```

---

## Phase gate

The phase is ready to close only when:

- all slices are complete and committed on the release branch
- lint, compile, and tests are green
- the README reflects the shipped review behavior
- the branch is pushed to origin
- the release artifact is built for the next version
