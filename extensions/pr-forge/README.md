# PR Forge

[![Version](https://img.shields.io/visual-studio-marketplace/v/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![License](https://img.shields.io/github/license/Mason01Kent/pr-forge)](https://github.com/Mason01Kent/pr-forge/blob/master/LICENSE)

**From diff to draft PR without leaving VS Code.**

PR Forge reads your git diff and commits, generates a pull request title, description, and review, then submits or updates the PR on GitHub or GitLab - all from a sidebar panel.

No Copilot subscription. No per-seat fee. Bring your own API key and model.
If you skip the API key, PR body generation falls back to a git-driven template instead of AI output.

---

## What it does

- **Generate PR Body** - AI-written title and description from your `base..HEAD` diff, commits, optional test output, and repository PR/MR templates when present; if no AI key is configured, PR Forge falls back to a git-driven template body
- **Generate PR Review** - structured review with blocking issues, suggestions, security concerns, test coverage, and a recommendation
- **Post Inline Review** - post line-anchored inline review comments directly on the diff (GitHub review API, or GitLab discussion notes with a plain-note fallback)
- **Post Review as PR/MR Comment** - alternative: post the full review as a single comment on the submitted pull request or merge request
- **Open Inbox** - list all open pull requests (GitHub) or merge requests (GitLab) for the repository; select any item to open it in the browser or browse its review threads
- **Close PR / Close MR** - close the open pull request or merge request for the current branch without leaving VS Code (GitHub and GitLab)
- **Smart Submit/Update** - the Submit button checks for an existing PR or MR in the background and switches to "Update PR #N" automatically when one is already open for the branch
- **Seed from Issue** - browse open issues, then create a branch or seed a draft PR body from the selected issue
- **Submit PR / Submit Draft PR** - create or update a pull request or merge request without leaving VS Code (GitHub and GitLab, including Enterprise and self-managed)
- **Open Existing PR** - open the already-open PR or merge request for the current branch directly from the sidebar
- **Merge PR / Merge MR** - merge the open pull request or merge request for the current branch from VS Code after a confirmation warning
- **Review thread actions** - browse review threads, jump to file anchors, reply, and resolve/reopen where the host API supports it
- **Metadata automation** - carry labels, assignees, reviewers, and milestone values into GitHub and GitLab submissions when configured
- **Regenerate with feedback** - type an instruction in the Refine panel and hit Enter to revise the draft without re-running tests
- **File walkthrough** - opt-in `## Changes` per-file table appended to the PR body
- **Commit summaries** - opt-in `## Commits` table with one AI-written line per commit
- **Re-review on push** - opt-in: when new commits land on a branch with a submitted PR, PR Forge offers to re-run the review
- **Settings dropdown** - keeps the model picker and generation toggles tucked under one expandable section below API key and above branch
- **Model picker** - lists available models from your provider's API; selection saved to config automatically
- **Cancellable generation** - cancel at any point from the sidebar or progress notification
- **API keys in SecretStorage** - stored securely in VS Code, never in project files
- **Multi-provider** - DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, Ollama (local, no key required)
- **Project type detection** - seeds sensible defaults for .NET, Node, React, and Python

---

## Quick start

1. Click the **PR Forge** icon in the Activity Bar to open the sidebar.
2. Click **Init Config** (or **Set API Key**) — a guided wizard walks you through picking a provider and entering your API key, then writes `.pr-forge.json` in one step. You can skip the key to use template mode.
3. Switch to a feature branch and click **Generate PR Body** or **Generate PR Review**.

> **No API key?** Click *Skip* in the setup wizard. `Generate PR Body` still works — it writes a structured template body from git history, file changes, and test output, with no AI required.

> The model picker, Run Tests toggle, and other options live under the **Options** dropdown in the sidebar. Low-frequency actions (Set API Key, Init Config, Inbox, etc.) are tucked into the collapsible **Setup & Tools** section at the bottom.

---

## Install from VSIX

Download the release artifact from the repo root and install it with VS Code:

`pr-forge-1.6.9.vsix`

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

**GitHub** - uses your VS Code GitHub sign-in (falling back to `GITHUB_TOKEN`) to create, update, or close pull requests. The sidebar detects the GitHub remote and uses "PR" terminology throughout. If a PR already exists for your branch, the Submit button automatically relabels itself "Update PR #N" and the Close button becomes available. Draft PRs are supported. Labels, assignees, reviewers, milestone values, open issues, inbox items, and review threads are all surfaced through the GitHub API.

**GitLab** - uses a personal access token (set via "Set API Key" → "GitLab (SCM token)", api scope required) to create, update, or close merge requests. The sidebar detects the GitLab remote and switches all terminology to "MR" — button labels, tooltips, and confirmation dialogs all say "merge request". If an MR already exists for your branch, the Submit button relabels itself "Update MR #N" and the Close button becomes available. Labels, assignees, reviewers, milestone values, open issues, inbox items, and review threads are surfaced through the GitLab API, including self-managed instances reached through their host-specific API base URL.

**Inbox** - the Open Inbox button lists all open pull requests (GitHub) or merge requests (GitLab) for the repository. Select any item to open it in the browser or jump directly into browsing its review threads.

**Close PR / Close MR** - the Close button closes the open pull request or merge request for the current branch directly from the sidebar, after a confirmation dialog. Available on both GitHub and GitLab.

**Issue seeding** - open the issue flow from the sidebar or command palette, then choose to create a branch, seed a draft PR/MR body, or do both from the selected issue.

Repository PR/MR templates are discovered automatically from common locations such as `.github/PULL_REQUEST_TEMPLATE`, `docs/PULL_REQUEST_TEMPLATE`, and `.gitlab/merge_request_templates`, and the generated body includes that guidance when present.

After submitting, **Post Review to PR/MR** posts the full review as a single comment, or use **Post Inline Review** to post line-anchored comments directly on the diff (GitHub review API, or GitLab discussion notes when the API has enough diff metadata, with a plain-note fallback when it does not).

When a PR/MR already exists for the current branch, the sidebar also exposes **Merge PR / Merge MR** so you can finish the workflow without leaving VS Code. The merge action shows a warning first and then calls the provider's merge endpoint directly.

**Review threads** - the sidebar can browse review threads, open the underlying file anchor, open the remote discussion, reply to a thread, and resolve or reopen a thread when the host API supports that action. GitHub and GitLab do not expose identical review-thread behavior, so PR Forge shows only the actions the host can actually perform.

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
