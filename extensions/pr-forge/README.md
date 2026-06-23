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
- **GitHub-style preview** — rendered preview panel with copy / open-in-editor actions.
- **Submit PR / Submit Draft PR** — creates the PR on GitHub via the REST API without leaving VS Code.
- **Multi-provider** — switch between AI providers any time; API keys are stored in VS Code SecretStorage, never in project files.
- **Project type detection** — auto-detects .NET, Node, React, and Python to seed sensible defaults.

## Install

Search **"PR Forge"** in the VS Code Extensions panel, or install via CLI:

```
ext install masonkent.pr-forge
```

## Setup

1. Open the Command Palette (`Ctrl+Shift+P`) and run **PR Forge: Set API Key**.
2. Pick a provider (DeepSeek, OpenAI, Anthropic, OpenRouter, Groq, or Ollama) and paste its key.
3. Open a project folder and run **PR Forge: Initialize Project Config** to create `.pr-forge.json`.
4. Use the sidebar panel or status bar buttons to generate PR content.

## Project config

Each project gets a `.pr-forge.json` in its root. Key fields:

| Field | Description |
|---|---|
| `baseBranch` | Branch to diff against (default `main`). |
| `provider` / `defaultModel` | AI provider and model — updated automatically when you switch via **Set API Key**. |
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
