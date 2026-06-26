# Changelog

All notable changes to PR Forge are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
