# PR Forge

[![Version](https://img.shields.io/visual-studio-marketplace/v/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/masonkent.pr-forge)](https://marketplace.visualstudio.com/items?itemName=masonkent.pr-forge)
[![License](https://img.shields.io/github/license/Mason01Kent/pr-forge)](https://github.com/Mason01Kent/pr-forge/blob/master/LICENSE)

AI-powered PR description and review generator for VS Code.

PR Forge turns your branch diff into a polished PR title, description, and full code review — then submits the PR to GitHub, all from a sidebar panel or the status bar.

Supports **DeepSeek**, **OpenAI**, **Anthropic**, **OpenRouter**, **Groq**, and **Ollama** (local).

## Features

- **Generate PR Body** — AI-written title + description from your `base..HEAD` diff, commits, and test output.
- **Generate Full PR Review** — structured review with blocking issues, suggestions, security concerns, test coverage, and a recommendation.
- **Live streaming preview** — tokens stream into the sidebar as the model writes; no waiting for the full response.
- **Regenerate with feedback** — type an instruction in the preview footer and hit Enter to revise the draft without re-running tests.
- **Model picker** — dropdown lists available models for your provider; selection is saved to config automatically.
- **Large-context mode** — Claude, GPT-4o, and DeepSeek receive the full diff in one shot; chunked summarization only kicks in for smaller models.
- **Submit PR / Submit Draft PR** — creates or updates the PR on GitHub via the REST API without leaving VS Code.
- **Cancellable generation** — hit Cancel on the progress notification at any point to abort mid-stream.
- **Multi-provider** — DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, Ollama. API keys stored in VS Code SecretStorage, never in project files.
- **Project type detection** — auto-detects .NET, Node, React, and Python to seed sensible defaults.

## Install

**Option A — VS Code Marketplace** (search or CLI):

```
ext install masonkent.pr-forge
```

**Option B — directly from this repo** (no build required):

Download [`extensions/pr-forge/pr-forge-0.4.0.vsix`](extensions/pr-forge/pr-forge-0.4.0.vsix), then install it:

```
code --install-extension pr-forge-0.4.0.vsix
```

Or via the Extensions panel: `⋯ menu → Install from VSIX…`

## Setup

1. Click the **PR Forge icon** in the Activity Bar to open the sidebar.
2. Click **🔑 Set API Key** — pick your provider and paste its key.
3. Click **⚙ Init Config** (or run **PR Forge: Initialize Project Config** from the Command Palette) to create `.pr-forge.json` in your project root.
4. Switch to a feature branch and click **⇄ Generate PR Body** or **✦ Generate PR Review**.

> **Tip:** The sidebar model dropdown lets you switch models without editing any files. The Run Tests toggle skips the test step when you just want a quick regeneration.

## Project config

Each project gets a `.pr-forge.json` in its root. The sidebar writes most fields for you, but you can edit it directly with **✎ Open Config**.

| Field | Description |
|---|---|
| `baseBranch` | Branch to diff against (default `main`). |
| `provider` / `defaultModel` | AI provider and model — updated automatically when you use the sidebar controls. |
| `runTestsOnGenerate` | Whether to run the test command before generating (default `true`). |
| `outputDirectory` | Where generated files go (default `.pr/`). |
| `reviewRulesFiles` | Files (e.g. `README.md`, `AGENTS.md`) injected as project standards into the prompt. |
| `prRiskAreas` | Risk areas to highlight in the body/review. |
| `prBodySections` | Section headings for the generated PR body. |

## Generated files

| File | Description |
|---|---|
| `.pr/PR_TITLE.txt` | Suggested PR title |
| `.pr/PR_BODY.md` | Full PR description |
| `.pr/PR_REVIEW.md` | Full PR review (only with **Generate Full PR Review**) |

## GitHub submission

Submission uses your VS Code GitHub sign-in, falling back to the `GITHUB_TOKEN` environment variable. The remote `origin` must be a GitHub URL (HTTPS or SSH).

## License

MIT — see the [repository](https://github.com/Mason01Kent/pr-forge) for details.
