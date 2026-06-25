# PR Forge

[![Version](https://img.shields.io/visual-studio-marketplace/v/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![License](https://img.shields.io/github/license/Mason01Kent/pr-forge)](https://github.com/Mason01Kent/pr-forge/blob/master/LICENSE)
[![Releases](https://img.shields.io/github/v/release/Mason01Kent/pr-forge)](https://github.com/Mason01Kent/pr-forge/releases)

AI-powered pull request title, description, and code review generator for VS Code.

PR Forge turns your branch diff into a polished pull request title, description, and full code review, then submits the pull request to GitHub from a sidebar panel or the status bar.

**The only VS Code extension that drafts your PR title + description, generates the review, and submits the PR — all with your own model and provider. No Copilot subscription, no per-seat fee — bring your own API key.**

Supports **DeepSeek**, **OpenAI**, **Anthropic**, **OpenRouter**, **Groq**, and **Ollama**.

## Features

- **Generate PR Body** - AI-written title and description from your `base..HEAD` diff, optional recent commits, and test output.
- **Generate PR Review** - structured review with blocking issues, suggestions, security concerns, test coverage, and a recommendation.
- **Sidebar progress flow** - generation stays on the tools view, shows live step updates inline, and opens the editor tab automatically when complete.
- **Title row** - shows a shortened sidebar title from `.pr/PR_TITLE.txt` with the full title in the tooltip.
- **Inline preview with feedback** - open the PR body or review from the sidebar, then regenerate the body with a targeted instruction without re-running tests.
- **Model picker** - dropdown lists available models from your provider API and falls back to curated defaults if needed.
- **Large-context mode** - Claude, GPT-4o, and DeepSeek can receive the full diff directly; chunked summarization is reserved for smaller models.
- **Submit PR / Submit as Draft** - creates or updates the pull request on GitHub without leaving VS Code.
- **Post Review to PR** - optionally post the generated review as a single comment on the submitted PR, using your existing GitHub sign-in (no Copilot, no extra cost).
- **Post Inline Review** - post a GitHub review with comments anchored to specific lines, plus committable one-line **suggestions** — the same shape as Copilot's review, but with your own model.
- **File walkthrough** - optionally append an AI-summarised `## Changes` per-file table to the PR body.
- **Re-review on push** - opt-in: when new commits land on a branch with a submitted PR, PR Forge offers to re-run the review (accept or dismiss — no silent token spend).
- **Cancellable generation** - cancel from the sidebar activity strip or the VS Code progress notification.
- **Include recent commits** - optional workspace setting stored in `.pr-forge.json` controls whether recent commit messages are included.
- **Commit summaries** - optionally append an AI-summarised `## Commits` table to the PR body (one concise line per commit, like GitHub's), generated in a single batched call.
- **Multi-provider** - API keys are stored in VS Code SecretStorage, never in project files.
- **Project type detection** - seeds sensible defaults for .NET, Node, React, and Python projects.

## How PR Forge compares

Most tools either *review* your PR or *manage* it. PR Forge is the only one that **authors the title and description, generates the review, and submits the PR** — with your own model.

| | BYOK / multi-provider | Authors PR title + body | Generates review | Submits / updates PR | Price |
|---|:---:|:---:|:---:|:---:|---|
| **PR Forge** | ✅ | ✅ | ✅ | ✅ | **Free (BYOK)** |
| GitHub Pull Requests (official) | ❌ | ❌ | ❌ | ✅ | Free |
| GitHub Copilot PR features | ❌ (GPT only) | ✅ | ✅ | ❌ | Subscription |
| BYOK review extensions | ✅ | ❌ | ✅ | ❌ | Subscription |

PR Forge posts reviews **inline** (line-anchored comments + committable suggestions) or as a single comment, your choice. Honest scope: multi-line suggestion ranges are planned; single-line suggestions ship today.

## Support matrix

| | Status |
|---|---|
| Submission host | **GitHub only** (GitLab/Bitbucket planned) |
| VS Code | `^1.85.0` |
| Tested providers | DeepSeek, OpenAI, Anthropic |
| Best-effort providers | OpenRouter, Groq, Ollama |

## Install

**Option A - VS Code Marketplace**:

```bash
code --install-extension masonkent.pr-forge
```

**Option B - local packaging**:

```bash
cd extensions/pr-forge
npm ci
npm run compile
npx vsce package --no-dependencies
code --install-extension pr-forge-1.2.0.vsix
```

Or use the Extensions panel and choose `Install from VSIX...`.

## Setup

1. Click the **PR Forge** icon in the Activity Bar to open the sidebar.
2. Click **Set API Key** and store a provider key.
3. Click **Init Config** to create `.pr-forge.json` in your project root.
4. Switch to a feature branch and click **Generate PR Body** or **Generate PR Review**.
5. Use **Include recent commits** if you want commit messages included in the prompt.

> The model dropdown, Run Tests toggle, and Include recent commits toggle are controlled directly from the sidebar.
>
> During generation, the sidebar stays on the tools view and shows an inline activity area with the current step and Cancel. After a successful run, the sidebar restores a generated-content card below Reset with the current time and the open/preview actions.

## Project Config

Each project gets a `.pr-forge.json` in its root. The sidebar writes most fields for you, but you can edit it directly with **Open Config**.

| Field | Description |
|---|---|
| `baseBranch` | Branch to diff against. Default: `main` in new configs, but this repo's current root config uses `master`. |
| `provider` / `defaultModel` | AI provider and model, updated automatically from the sidebar controls. |
| `runTestsOnGenerate` | Whether to run the configured test command before generation. |
| `includeRecentCommits` | Whether to include recent commit messages in PR body and title generation. |
| `includeCommitSummaries` | Whether to append an AI-summarised `## Commits` table (one line per commit) to the PR body. |
| `includeFileWalkthrough` | Whether to append an AI-summarised `## Changes` per-file table to the PR body. |
| `reReviewOnPush` | When on and a PR is submitted, offer to re-run the review after new commits land. |
| `outputDirectory` | Where generated files are written. Default: `.pr/`. |
| `reviewRulesFiles` | Files such as `README.md` or `AGENTS.md` injected into the prompt as project standards. |
| `prRiskAreas` | Risk areas to highlight in the body and review. |
| `prBodySections` | Section headings for the generated PR body. |

## Generated Files

| File | Description |
|---|---|
| `.pr/PR_TITLE.txt` | Suggested PR title |
| `.pr/PR_BODY.md` | Full PR description |
| `.pr/PR_REVIEW.md` | Full PR review, generated only with **Generate PR Review** |

## Submitting Pull Requests

PR Forge uses your VS Code GitHub sign-in, falling back to `GITHUB_TOKEN`, to submit pull requests. If a pull request already exists for your branch, it offers to update the title and body instead of creating a duplicate.

It will not generate on the base branch, and it prompts when config, API key, or git state is missing.

After a PR is submitted, **Post Review to PR** posts the generated review (`.pr/PR_REVIEW.md`) as a single comment on that PR. It uses the same GitHub token as submission — no Copilot and no extra cost.

**GitHub is currently the only supported submission target.** Non-GitHub remotes (including GitLab) are rejected with a clear message; GitLab Merge Request submission is planned for a future release.

## Development

```bash
npm install
npm run build
npm run lint
npm run package:vsix
```

`npm run build` runs TypeScript compile plus bundling. `npm run package:vsix` creates the release artifact with `vsce`.

## Privacy & telemetry

**Your code and keys stay yours.** API keys live in VS Code SecretStorage, never in project files. Your diff is sent only to the AI provider *you* configure — never to PR Forge's authors. The review and body are written locally; nothing is posted to GitHub unless you explicitly submit a PR or click **Post Review to PR**.

PR Forge collects anonymous usage data to improve the extension. **Never collected:** code, diffs, PR content, file paths, branch names, or API keys.

**Collected:** activation events, feature usage, provider and model names, outcome, token counts, estimated cost, and broad error categories.

To opt out, disable `telemetry.telemetryLevel` in VS Code settings (turns off telemetry for all extensions) or set `"prForge.telemetry.enabled": false` in user settings.

## License

MIT - see the [repository](https://github.com/Mason01Kent/pr-forge) for details.
