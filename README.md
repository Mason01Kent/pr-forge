# PR Forge

[![Version](https://img.shields.io/visual-studio-marketplace/v/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![License](https://img.shields.io/github/license/Mason01Kent/pr-forge)](LICENSE)

**From diff to draft PR without leaving VS Code.**

PR Forge reads your git diff and commits, generates a pull request title, description, and review summary, then submits or updates the PR on GitHub — all from a sidebar panel. No Copilot subscription. No per-seat fee. Bring your own API key.

---

## The workflow

```
Change code  →  Generate title/body/review  →  Preview & edit  →  Submit or update GitHub PR
```

---

## Demo assets needed

> Screenshots and GIFs are not yet in the repo. Contributions welcome.

| Placeholder | What to capture |
|---|---|
| `docs/assets/sidebar.png` | PR Forge sidebar with generate controls visible |
| `docs/assets/generated-pr-body.png` | Generated PR body open in the editor |
| `docs/assets/generated-review.png` | Generated review document |
| `docs/assets/submit-pr-flow.gif` | Full submit-PR flow from sidebar to GitHub |

---

## Why PR Forge?

Writing a PR description from scratch is tedious. PR Forge reads your diff and recent commits and writes the first draft for you — structured, consistent, and ready to edit. Your reviewer gets the context they need; you skip the blank-page problem.

Most tools either *review* your PR or *manage* it. PR Forge does both: it authors the title and description, generates a structured review, and submits the PR to GitHub — all with the model and provider you choose.

---

## Features

- **Generate PR Body** — AI-written title and description from your `base..HEAD` diff, commits, and optional test output
- **No-AI fallback** — when no API key is configured, Generate PR Body produces a structured template (branch name, diffstat, changed-files table, commits table) you can fill in manually; no key required
- **Generate PR Review** — structured review with blocking issues, suggestions, security concerns, test coverage, and a recommendation
- **Post Inline Review** — post a proper GitHub review with comments anchored to specific diff lines, plus committable one-line suggestions (same shape as Copilot's review, with your own model)
- **Post Review as PR Comment** — alternative: post the full review as a single comment on the submitted PR
- **Submit PR / Submit as Draft** — creates a GitHub pull request (or GitLab merge request) without leaving VS Code; draft PRs are supported
- **Smart Submit/Update button** — automatically detects an open PR or MR for your branch and relabels itself "Update PR #N" / "Update MR #N" so you never accidentally create a duplicate
- **Open Inbox** — list open pull requests (GitHub) or merge requests (GitLab) from the sidebar; select any to open in the browser or jump into reviewing its threads
- **Close PR / Close MR** — close the open PR or MR for the current branch directly from the sidebar, with a confirmation dialog
- **Regenerate with feedback** — type an instruction in the Refine panel to revise the draft without re-running tests
- **Repository template awareness** — PR body generation picks up GitHub and GitLab template files and folds that guidance into both AI and no-AI drafts
- **Submission metadata** — attach labels, assignees, reviewers, and milestone values to GitHub PRs and GitLab MRs when configured
- **File walkthrough** — opt-in `## Changes` per-file table appended to the PR body
- **Commit summaries** — opt-in `## Commits` table with one AI-written line per commit
- **Re-review on push** — opt-in: when new commits land on a branch with a submitted PR, PR Forge offers to re-run the review (accept or dismiss — no silent token spend)
- **Model picker** — lists models from your provider's API; selection saved to `.pr-forge.json` automatically
- **Cancellable generation** — cancel at any point from the sidebar or progress notification
- **Multi-provider** — DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, Ollama
- **GitLab support** — create, update, comment, and post inline reviews on GitLab MRs; button labels and terminology switch between "PR" and "MR" based on your remote
- **API keys in SecretStorage** — stored securely in VS Code; never written to project files
- **Project type detection** — seeds sensible defaults for .NET, Node, React, and Python projects

---

## Generated files

| File | Description |
|---|---|
| `.pr/PR_TITLE.txt` | Suggested pull request title |
| `.pr/PR_BODY.md` | Full pull request description |
| `.pr/PR_REVIEW.md` | Full code review (Generate PR Review only) |

---

## Supported providers

| Provider | Key required | Notes |
|---|---|---|
| DeepSeek | Yes | Tested |
| OpenAI | Yes | Tested |
| Anthropic | Yes | Tested |
| OpenRouter | Yes | Best-effort |
| Groq | Yes | Best-effort |
| Ollama | No | Local; no API key needed |

---

## Quick start

**Install from Marketplace:**

```
ext install masonkent.pr-forge
```

**Install from VSIX** (no build required):

```bash
code --install-extension extensions/pr-forge/pr-forge-1.6.8.vsix
```

Or via the Extensions panel: `⋯ menu → Install from VSIX…`

**First run:**

1. Click the **PR Forge** icon in the Activity Bar to open the sidebar.
2. Click **Set API Key** — pick your provider and paste its key.
3. Click **Init Config** (or run **PR Forge: Initialize Project Config** from the Command Palette) to create `.pr-forge.json` in your project root.
4. Switch to a feature branch and click **Generate PR Body** or **Generate PR Review**.

> **Tip:** The sidebar model dropdown lets you switch models without editing any files. The Run Tests toggle skips the test step when you want a quick regeneration.

---

## Project config

`.pr-forge.json` is created by **Init Config** and updated automatically by the sidebar controls. You can also edit it directly via **Open Config**.

| Field | Default | Description |
|---|---|---|
| `baseBranch` | `main` | Branch to diff against |
| `provider` / `defaultModel` | — | AI provider and model; updated by the sidebar |
| `runTestsOnGenerate` | `true` | Run the configured test command before generating |
| `includeRecentCommits` | `false` | Include recent commit messages in the prompt |
| `includeCommitSummaries` | `false` | Append an AI-summarised commits table to the PR body |
| `includeFileWalkthrough` | `false` | Append a per-file changes table to the PR body |
| `reReviewOnPush` | `false` | Offer to re-run the review when new commits land on the branch |
| `outputDirectory` | `.pr/` | Where generated files are written |
| `reviewRulesFiles` | — | Files (e.g. `README.md`, `AGENTS.md`) injected as project standards into the prompt |
| `prRiskAreas` | — | Risk areas to highlight in the body and review |
| `prBodySections` | — | Section headings for the generated PR body |

---

## GitHub and GitLab submission

PR Forge uses your VS Code GitHub sign-in (falling back to `GITHUB_TOKEN`) for GitHub PRs, and a GitLab personal access token (api scope) for GitLab MRs. If a PR or MR already exists for your branch, the Submit button automatically switches to "Update PR #N" / "Update MR #N".

After a PR or MR is submitted, use **Post Review to PR** for a single comment or **Post Inline Review** for line-anchored comments with committable suggestions — no Copilot, no extra cost.

**Not yet supported:** Bitbucket, Azure DevOps, GitHub Enterprise with a custom host.

---

## Limitations / Roadmap

**Current limitations:**

- Bitbucket and Azure DevOps submission not yet supported
- GitHub Enterprise / custom host not yet supported
- Multi-line committable suggestion ranges not yet supported (single-line only)
- Single-workspace only

**Planned:**

- GitHub Enterprise / custom host support
- Bitbucket and Azure DevOps submission
- Multi-line committable suggestions
- Better onboarding and demo examples

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full feature backlog.

---

## Privacy / Security

**Your code and keys stay yours.** API keys live in VS Code SecretStorage, never in project files. Your diff is sent only to the AI provider *you* configure — never to PR Forge's authors. Nothing is posted to GitHub unless you explicitly submit a PR or click **Post Review to PR**.

PR Forge collects anonymous usage data to improve the extension. **Never collected:** code, diffs, PR content, file paths, branch names, or API keys. **Collected:** activation events, feature usage, provider and model names, outcome, token counts, estimated cost, and broad error categories.

To opt out: set `"prForge.telemetry.enabled": false` in VS Code user settings, or disable `telemetry.telemetryLevel` globally (turns off telemetry for all extensions).

---

## Repo layout

```
extensions/pr-forge/    VS Code extension (TypeScript + esbuild)
docs/ROADMAP.md         Feature backlog
docs/setup.md           Setup and troubleshooting guide
```

## License

MIT — see [LICENSE](LICENSE).
