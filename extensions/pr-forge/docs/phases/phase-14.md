# Phase 14 - PR/MR Inbox and Merge Readiness (v1.5.0)

**Goal:** Move PR Forge beyond generation and submission into a real PR/MR workbench: see what is already open, understand merge readiness, and act on reviews without leaving VS Code.

## Prerequisites

- Phase 13 is complete, published, and stable
- Working dir: `C:\Users\codtv\Desktop\Apps\MasonDevTools\extensions\pr-forge`
- GitHub and GitLab API access remain available for existing SCM flows

## Product bets

- **Inbox first** - surface open pull requests and merge requests before users have to leave VS Code
- **Merge readiness** - show status checks, blocking conditions, and review requirements clearly
- **Review operations** - let users browse, jump to, and act on existing review comments and threads
- **Issue to branch** - bridge tracked issues into branch and PR workflows instead of treating them separately
- **Enterprise fit** - keep the same workflows usable on GitHub Enterprise and GitLab self-managed instances

## Permanent architectural rules

- **No `vscode` imports in `src/scm/`** - keep provider logic unit-testable
- **SCM providers stay isolated** - GitHub and GitLab behavior belongs in `src/scm/`
- **No direct browser scraping for core data** - use official APIs first, browser automation only if a host has no API path
- **Tests go in `src/test/`** - mock network calls and keep all tests deterministic
- **README must stay honest** - supported hosts, limits, and workflows must match shipped behavior
- **Commit format:** `Phase 14 Slice N: <summary>` with the standard Co-Authored-By trailer if the team keeps using it

## Slices

### Slice 14.1 - PR/MR inbox

**Goal:** Show open PRs and merge requests for the current repository, with enough metadata to find the right item quickly.

**Files in scope:**
- `src/scm/github.ts` - list open pull requests for the repository
- `src/scm/gitlab.ts` - list open merge requests for the repository
- `src/extension.ts` - add inbox commands and wiring
- `src/sidebarProvider.ts` - add the inbox UI entry point
- `src/test/scm.test.ts` - cover list endpoints and mapping

**Acceptance criteria:**
1. The extension can list open PRs/MRs for GitHub and GitLab remotes
2. The sidebar exposes a useful entry point to the inbox without requiring a browser
3. Opening an item takes the user to the correct remote URL
4. `npm run lint`, `npm run compile`, and `npm test` all pass

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
```

---

### Slice 14.2 - Merge readiness

**Goal:** Surface the information that decides whether a PR/MR is actually ready to merge: checks, approvals, conflicts, and branch status.

**Files in scope:**
- `src/scm/github.ts` - query commit statuses, check runs, mergeability, and review state
- `src/scm/gitlab.ts` - query pipeline and approval/merge status
- `src/extension.ts` - wire readiness summaries into the UI and post-submit flow
- `src/sidebarProvider.ts` - show readiness indicators and blockers
- `src/test/scm.test.ts` - cover status and readiness mapping

**Acceptance criteria:**
1. GitHub mergeability state and checks are visible from the extension
2. GitLab pipeline and approval blockers are visible from the extension
3. The UI makes it clear what blocks merge versus what is informational
4. `npm run lint`, `npm run compile`, and `npm test` all pass

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
```

---

### Slice 14.3 - Review operations

**Goal:** Make existing review threads actionable from VS Code instead of being read-only noise.

**Files in scope:**
- `src/scm/github.ts` - fetch PR review threads and comments
- `src/scm/gitlab.ts` - fetch MR discussions and notes
- `src/extension.ts` - add review navigation and action commands
- `src/sidebarProvider.ts` - add thread/comment navigation
- `src/test/scm.test.ts` - cover review thread retrieval and action mapping

**Acceptance criteria:**
1. Users can browse existing review threads from the extension
2. Users can jump from the sidebar to the right file or remote discussion
3. The extension can distinguish resolved, unresolved, and actionable comments when the host provides that state
4. `npm run lint`, `npm run compile`, and `npm test` all pass

**Verification commands:**
```bash
npm run lint
npm run compile
npm test
```

---

### Slice 14.4 - Issue and enterprise workflow

**Goal:** Close the loop between issues, branches, and releases, while keeping GitHub Enterprise and GitLab self-managed installs usable.

**Files in scope:**
- `src/extension.ts` - issue-assisted branch or PR creation flows
- `src/scm/github.ts` - issue lookup and enterprise-host base URL handling
- `src/scm/gitlab.ts` - issue lookup and self-managed base URL handling
- `src/test/scm.test.ts` - cover issue lookup and non-public host behavior
- `README.md` - document enterprise/self-managed support and issue workflows

**Acceptance criteria:**
1. Users can look up issues and seed a branch or PR from them when the host supports it
2. GitHub Enterprise and GitLab self-managed hosts work through configurable API bases
3. The README clearly describes what is supported and what is not
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
- the README reflects the shipped inbox/readiness/review behavior
- the branch is pushed to origin
- the release artifact is built for the next version
