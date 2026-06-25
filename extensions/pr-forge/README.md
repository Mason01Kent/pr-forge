# PR Forge

[![Version](https://img.shields.io/visual-studio-marketplace/v/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![License](https://img.shields.io/github/license/Mason01Kent/pr-forge)](https://github.com/Mason01Kent/pr-forge/blob/master/LICENSE)

**From diff to draft PR without leaving VS Code.**

PR Forge reads your git diff and commits, generates a pull request title, description, and review summary, then submits or updates the PR on GitHub — all from a sidebar panel.

No Copilot subscription. No per-seat fee. Bring your own API key and model.

---

## What it does

- **Generate PR Body** — AI-written title and description from your `base..HEAD` diff, commits, and optional test output
- **Generate PR Review** — structured review with blocking issues, suggestions, security concerns, test coverage, and a recommendation
- **Submit PR** — creates a GitHub pull request without leaving VS Code
- **Submit Draft PR** — creates a draft PR for early feedback
- **Update existing PR** — detects an open PR for your branch and offers to update it instead of creating a duplicate
- **Post Review as PR Comment** — posts the generated review as a single comment on the submitted PR; uses your existing GitHub sign-in, no extra cost
- **Bring your own model** — DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, or Ollama (local)
- **API keys in SecretStorage** — stored securely in VS Code, never in project files

---

## Quick start

1. Click the **PR Forge** icon in the Activity Bar to open the sidebar.
2. Click **Set API Key** — pick your provider and paste its key.
3. Click **Init Config** to create `.pr-forge.json` in your project root.
4. Switch to a feature branch and click **Generate PR Body** or **Generate PR Review**.

> The model dropdown, Run Tests toggle, and other options are controlled directly from the sidebar. Generation streams live into the sidebar as the model writes.

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

## GitHub submission

PR Forge uses your VS Code GitHub sign-in (falling back to `GITHUB_TOKEN`) to create or update pull requests. If a PR already exists for your branch, it offers to update the title and body instead of opening a duplicate. Draft PRs are supported.

After submitting, **Post Review to PR** posts the generated review as a single comment on the PR.

---

## Limitations

- **GitHub only** — GitLab Merge Request support is planned; Bitbucket and Azure DevOps are not currently supported
- **Line-level diff comments are not supported yet** — reviews post as a single PR comment, not as inline line annotations
- **No Bitbucket or Azure DevOps support**

---

## Privacy & telemetry

**Your code and keys stay yours.** API keys live in VS Code SecretStorage, never in project files. Your diff is sent only to the AI provider *you* configure — never to PR Forge's authors. Nothing is posted to GitHub unless you explicitly submit a PR or click **Post Review to PR**.

PR Forge collects anonymous usage data to improve the extension. **Never collected:** code, diffs, PR content, file paths, branch names, or API keys. **Collected:** feature usage, provider and model names, outcome, token counts, and broad error categories.

To opt out: set `"prForge.telemetry.enabled": false` in VS Code user settings, or disable `telemetry.telemetryLevel` globally.

---

## More

Full documentation, config reference, and roadmap: [github.com/Mason01Kent/pr-forge](https://github.com/Mason01Kent/pr-forge)
