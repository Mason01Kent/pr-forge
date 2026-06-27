# Changelog

## 1.6.9

### Fixed
- **Looping "Posting review…" notification** — the progress spinner now dismisses as soon as the network call finishes. The "Open in Browser" toast appears once after, instead of keeping the spinner up indefinitely.
- **Readiness shows "Draft" instead of "Blocked"** when the only reason a PR isn't mergeable is that it's marked as a draft. A hover tooltip explains exactly why and what to do. Genuine blockers (failing CI, conflicts, changes requested) still show "Blocked" with a tooltip listing them.
- **"Open Existing PR" is now hidden** when no open PR exists for the current branch, instead of showing and doing nothing when clicked.
- **"View Body" and "View Review" buttons restored** — a "PR Content" card now appears in the sidebar whenever content has been generated, giving you one-click access to re-open the rendered preview panel after closing it.

### Added
- **Tooltips on every control** — every button, checkbox, dropdown, and status badge now has a plain-language hover tooltip explaining what it does, so new users don't have to guess.

## 1.6.8

### Fixed
- Sidebar now updates immediately when switching branches in an external terminal. A file-system watcher on `.git/HEAD` triggers a workspace state refresh on every `git checkout`, so the Branch row, Generate button labels, and artifact state all reflect the new branch without needing to interact with VS Code first.

## 1.6.7

### Fixed
- Generate PR Body / Generate PR Review buttons no longer say "Regenerate" when switching to a branch that has no generated content. `PR_BODY.state.json` (written by the generator) already records which branch artifacts belong to — `readGeneratedArtifacts` now reads that and treats files from a different branch as absent.

## 1.6.6

### Changed
- Removed the inline **Change / Remove** links next to the API Key badge in the status card — key management now lives solely in **Setup & Tools** (Change API Key / Remove API Key).
- Made the destructive buttons (**Reset**, **Close PR**, **Remove API Key**) clearly legible — they now share a higher-contrast danger style with a brighter label, tinted background, and stronger border, instead of low-contrast red text on a dark button.

## 1.6.5

### Fixed
- Removed a stray bit of text and a tiny clickable "white dash" that leaked in above the PR FORGE header. The Content-Security-Policy ignored inline `style="display:none"` attributes, so an off-screen compatibility block (a workflow hint and a hidden duplicate API-key button) rendered visibly. The block is now hidden via the stylesheet, and `style-src` permits inline styles so the remaining hidden sections no longer flash on load.

## 1.6.4

### Changed
- **First-run onboarding** - replaced the easy-to-miss inline notice with a prominent setup card at the top of the sidebar. First-time setup (config + optional provider/key) is now one click from the main view, no need to open Setup & Tools.
- The onboarding card states clearly that an API key is **optional** — PR Forge generates PR bodies from templates without one, and a key unlocks AI descriptions and review.

### Added
- **Inline API key management** - when a key is stored, the API Key row shows **Change** (switch provider or key) and **Remove** actions; a matching "Remove API Key" button is also available in Setup & Tools. The Set/Change label updates with state.

### Fixed
- Reduced duplicate notification toasts during first-run setup — the guided wizard no longer fires a separate "Config initialized" message on top of its own ready message.

### Fixed
- Sidebar buttons were completely unresponsive (acting like static images) due to a duplicate `const` declaration in the webview script, which raised a `SyntaxError` that prevented the entire script — and all button event handlers — from loading. Only native controls (checkboxes, dropdowns) kept working. Removing the redundant declaration restores all buttons, the preview/back navigation, and the stale-state reset.

## 1.5.9

### Added
- **Merge PR / Merge MR** - merge an open pull request or merge request from the sidebar after a confirmation warning; the action uses the provider merge endpoint directly.

### Changed
- Updated the README install and workflow text to describe the new merge action.
- Kept the release packaging and docs aligned with the current VSIX filename.

## 1.5.8

### Changed
- Refined the sidebar into a more guided workflow with clearer action grouping, state-aware submit labels, and more tooltips.
- Tightened the preview panel layout so PR body and review output read more like structured documents.
- Updated the README install reference and release packaging to match the current VSIX.

All notable changes to PR Forge are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## 1.5.3

### Fixed
- Submit PR, Submit Draft PR, and Open Existing PR buttons are now hidden when in detached HEAD state or on the base branch (main/master) — previously they remained accessible and could produce confusing errors

## 1.5.2

### Added
- **Open Inbox** - list open pull requests (GitHub) or merge requests (GitLab) for the repository from the sidebar; select any item to open it in the browser or jump straight into reviewing its threads
- **Close PR / Close MR** - close the open pull request or merge request for the current branch directly from the sidebar, with a confirmation dialog; works on GitHub and GitLab
- **Smart Submit/Update button** - the Submit button now checks for an existing PR or MR in the background and automatically relabels itself "Update PR #N" (or "Update MR #N") when one is already open for the branch
- **GitHub / GitLab aware UI** - button labels, tooltips, and terminology dynamically switch between "PR" and "MR" throughout the sidebar based on whether the repository remote is GitHub or GitLab

## 1.4.0

### Added
- **Repository template awareness** - PR body generation now picks up common GitHub and GitLab template locations and folds that guidance into both AI and no-AI drafts.
- **Submission metadata automation** - GitHub and GitLab submissions can now carry labels, assignees, reviewers, and milestone values when configured.
- **GitLab review parity** - inline review comments use GitLab discussions when the merge request version refs are available, and fall back to notes when they are not.

### Changed
- Updated the README and release workflow to match the 1.4.0 feature set.

## 1.3.0

### Added
- **GitLab Merge Request support** - create, update, comment, and post inline reviews on GitLab MRs. Set a GitLab personal access token via "Set API Key" -> "GitLab (SCM token)" (api scope required). Inline review falls back to plain MR notes if line anchoring is unavailable.
- **No-API-key PR body template** - when no AI key is configured, "Generate PR Body" produces a structured template (branch name, diffstat, changed-files table, commits table) you can fill in manually.

## 1.2.1

### Changed
- The "Refine this draft" box in the body preview is now a clearly labeled panel with an accent border and a primary action button, so it is no longer mistaken for part of the PR body text.

## 1.2.0

GitHub Copilot PR parity. Everything below is opt-in and uses your own model/provider and GitHub token - no Copilot.

### Added
- **Inline review comments** - a new "Post Inline Review" action posts a GitHub review with comments anchored to specific lines, plus the prose review as the review body. Findings are generated from the diff on demand; lines are validated/snapped to the diff so the API never 422s, with a single-comment fallback if anchoring is unavailable.
- **Committable suggestions** - inline comments can include an "Apply suggestion" block when the model proposes a one-line fix.
- **File walkthrough** - an opt-in toggle that appends an AI-summarised `## Changes` per-file table to the PR body (`includeFileWalkthrough`).
- **Commit summaries** - an opt-in `## Commits` table, one concise AI line per commit (`includeCommitSummaries`). Batched in a single call and cached per HEAD.
- **Re-review on push** - an opt-in toggle (`reReviewOnPush`); when on and a PR is submitted, PR Forge notices new commits and offers (accept/dismiss) to re-run the review. No silent token spend.
- The built-in markdown preview now renders GitHub-style pipe tables.

## 1.0.0

First stable release. GitHub-first, solo-developer-focused, bring-your-own-model.

### What's stable in 1.0
- **Generate PR title + body** from your `base..HEAD` diff, optional recent commits, and test output.
- **Generate PR review** - blocking issues, suggestions, security concerns, test coverage, and a recommendation, written to `.pr/PR_REVIEW.md`.
- **Regenerate body with an instruction** without re-running tests.
- **Submit / update PR to GitHub**, including draft PRs, using your VS Code GitHub sign-in (or `GITHUB_TOKEN`).
- **Post Review to PR** - opt-in: post the generated review as a single comment on the submitted PR (uses your existing GitHub token; no Copilot, no extra cost).
- **Multi-provider, BYOK** - DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, Ollama. Keys stored in VS Code SecretStorage.
- **Inline sidebar progress** - generation stays on the tools view with live step updates and a Cancel button; an activity card and view actions appear after a run.

### Scope
- **GitHub is the only supported submission target.** Non-GitHub remotes (including GitLab) are rejected with a clear message. GitLab Merge Request submission is planned for a future release.

### Hardening
- Actionable GitHub API error messages for auth (401), permissions/scope (403), not-found (404), and unprocessable (422) cases.
- Cleaner VSIX: development-only files (lint/test configs, agent docs) are excluded from the published package.

## 0.6.x (pre-1.0)

Iterative UI and workflow work leading up to 1.0:
- Sidebar redesigned to match VS Code's native look, with codicons and a compact layout.
- Inline activity area with live step updates and in-sidebar cancellation.
- View / preview actions for the generated body and review; "Open PR on GitHub" after submission.
- Model picker with live model discovery, Run Tests toggle, and Include Recent Commits toggle.
- Various fixes to API-key display, button labels, and post-run actions.
