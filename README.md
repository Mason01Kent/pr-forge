# PR Forge

[![Version](https://img.shields.io/visual-studio-marketplace/v/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![License](https://img.shields.io/github/license/Mason01Kent/pr-forge)](https://github.com/Mason01Kent/pr-forge/blob/master/LICENSE)

**From diff to draft PR without leaving VS Code.**

PR Forge reads your git diff and commits, generates a pull request title, description, and review, then submits or updates the PR on GitHub or GitLab - all from a sidebar panel.

No Copilot subscription. No per-seat fee. Bring your own API key and model.

---

## What it does

- **Generate PR Body** - AI-written title and description from your `base..HEAD` diff, commits, optional test output, and repository PR/MR templates when present
- **Generate PR Review** - structured review with blocking issues, suggestions, security concerns, test coverage, and a recommendation
- **Post Inline Review** - post a proper GitHub review with comments anchored to specific diff lines, plus committable one-line suggestions
- **Post Review as PR Comment** - alternative: post the full review as a single comment on the submitted PR
- **Seed from Issue** - browse open issues, then create a branch or seed a draft PR body from the selected issue
- **Submit PR / Submit Draft PR** - create or update a pull request or merge request without leaving VS Code
- **Open Existing PR** - open the already-open PR or merge request for the current branch directly from the sidebar
- **Metadata automation** - carry labels, assignees, reviewers, and milestone values into GitHub and GitLab submissions when configured
- **Regenerate with feedback** - type an instruction in the Refine panel and hit Enter to revise the draft without re-running tests
- **File walkthrough** - opt-in `## Changes` per-file table appended to the PR body
- **Commit summaries** - opt-in `## Commits` table with one AI-written line per commit
- **Re-review on push** - opt-in: when new commits land on a branch with a submitted PR, PR Forge offers to re-run the review
- **Model picker** - lists available models from your provider's API; selection saved to config automatically
- **Cancellable generation** - cancel at any point from the sidebar or progress notification
- **API keys in SecretStorage** - stored securely in VS Code, never in project files
- **Multi-provider** - DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, Ollama (local, no key required)
- **Project type detection** - seeds sensible defaults for .NET, Node, React, and Python

---

## Quick start

1. Click the **PR Forge** icon in the Activity Bar to open the sidebar.
2. Click **Set API Key** - pick your provider and paste its key.
3. Click **Init Config** to create `.pr-forge.json` in your project root.
4. Switch to a feature branch and click **Generate PR Body** or **Generate PR Review**.

> The model dropdown, Run Tests toggle, and other options are controlled directly from the sidebar. Generation streams live into the sidebar as the model writes.

---

## Install from VSIX

Download the release artifact from the repo root and install it with VS Code:

`pr-forge-1.5.0.vsix`

Use the VS Code command palette and run `Extensions: Install from VSIX...`.

---

## Generated files

| File | Description |
|---|---|
| `.pr/PR_TITLE.txt` | Suggested pull request title |
| `.pr/PR_BODY.md` | Full pull request description |
| `.pr/PR_REVIEW.md` | Full code review (Generate PR Review only) |

---

## Supported providers

DeepSeek · OpenAI · Anthropic · OpenRouter · Groq · Ollama (local, no key required)

---

## SCM submission

PR Forge supports **GitHub**, **GitHub Enterprise**, **GitLab**, and **GitLab self-managed** remotes.

**GitHub** - uses your VS Code GitHub sign-in (falling back to `GITHUB_TOKEN`) to create or update pull requests. If a PR already exists for your branch, it can update the title and body, compare the local draft against the existing PR, or open the existing PR instead of creating a duplicate. Draft PRs are supported. Labels, assignees, reviewers, milestone values, open issues, and review threads are surfaced through the GitHub API.

**GitLab** - uses a personal access token (set via "Set API Key" -> "GitLab (SCM token)", api scope required) to create or update merge requests. If a merge request already exists for your branch, it can update the title and description, compare the local draft against the existing MR, or open the existing MR instead of creating a duplicate. Labels, assignees, reviewers, milestone values, open issues, and review threads are surfaced through the GitLab API, including self-managed instances reached through their host-specific API base URL.

**Issue seeding** - open the issue flow from the sidebar or command palette, then choose to create a branch, seed a draft PR, or do both from the selected issue.

Repository PR/MR templates are discovered automatically from common locations such as `.github/PULL_REQUEST_TEMPLATE`, `docs/PULL_REQUEST_TEMPLATE`, and `.gitlab/merge_request_templates`, and the generated body includes that guidance when present.

After submitting, **Post Review to PR** posts the full review as a single comment, or use **Post Inline Review** to post line-anchored comments directly on the diff (GitHub) or as GitLab discussions when the API has enough diff metadata, with a note fallback when it does not.

---

## Limitations

- **GitLab inline review fallback** - line-anchored diff comments now use GitLab discussions when version refs are available, but plain notes are still used as a fallback when anchoring cannot be resolved
- **Bitbucket / Azure DevOps** - not yet supported
- **Multi-line suggestion ranges** are not yet supported - committable suggestions apply to a single line only

---

## Privacy & telemetry

**Your code and keys stay yours.** API keys live in VS Code SecretStorage, never in project files. Your diff is sent only to the AI provider *you* configure - never to PR Forge's authors. Nothing is posted to GitHub unless you explicitly submit a PR or click **Post Review to PR** / **Post Inline Review**.

PR Forge collects anonymous usage data to improve the extension. **Never collected:** code, diffs, PR content, file paths, branch names, or API keys. **Collected:** feature usage, provider and model names, outcome, token counts, and broad error categories.

To opt out: set `"prForge.telemetry.enabled": false` in VS Code user settings, or disable `telemetry.telemetryLevel` globally.

---

Full documentation, config reference, and roadmap: [github.com/Mason01Kent/pr-forge](https://github.com/Mason01Kent/pr-forge)
