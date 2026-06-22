# MasonDevTools Setup Guide (Windows + VS Code)

## Prerequisites

- Windows 10/11
- VS Code (latest stable)
- Node.js 18+ (for extension compilation)
- PowerShell 5.1 (included with Windows)
- Git (for repository operations)
- DeepSeek API key (for AI-generated PR content)

## Step 1: Clone or create the repo

```powershell
# If starting fresh:
mkdir C:\Users\codtv\Desktop\Apps\MasonDevTools
cd C:\Users\codtv\Desktop\Apps\MasonDevTools
git init
```

## Step 2: Open the workspace

```powershell
code C:\Users\codtv\Desktop\Apps\MasonDevTools\MasonDevTools.code-workspace
```

This opens both the root and the extension folder in VS Code.

## Step 3: Install extension dependencies

```powershell
cd C:\Users\codtv\Desktop\Apps\MasonDevTools\extensions\mason-pr-helper
npm install
npm run compile
```

Verify compilation succeeds with no errors.

## Step 4: Set the DeepSeek API key

### Option A: Per-session (temporary)

```powershell
$env:DEEPSEEK_API_KEY = "sk-your-key-here"
code
```

### Option B: Permanent (user environment variable)

1. Open **System Properties > Environment Variables**.
2. Add a new **User** variable:
   - Name: `DEEPSEEK_API_KEY`
   - Value: your API key
3. Restart VS Code.

### Option C: PowerShell profile

Add to `$PROFILE`:

```powershell
$env:DEEPSEEK_API_KEY = "sk-your-key-here"
```

## Step 5: Test the extension

1. Press `F5` in VS Code to launch the Extension Development Host.
2. In the new window, open any project folder.
3. Open the Command Palette (`Ctrl+Shift+P`).
4. Run `MasonDevTools: Initialize Project Config`.
5. This creates `.mason-devtools.json` in the project root.

## Step 6: Generate PR content

1. Run `MasonDevTools: Generate PR Body` to create `.pr/PR_BODY.md` and `.pr/PR_TITLE.txt`.
2. Run `MasonDevTools: Generate Full PR Review` to also create `.pr/PR_REVIEW.md`.

## Step 7: Use the status bar

The status bar shows three buttons when a workspace is open:

- `$(tools) MasonDevTools` — opens Project Config
- `$(git-pull-request) PR Body` — generates PR body
- `$(comment-discussion) PR Review` — generates full PR review

## Troubleshooting

### "DEEPSEEK_API_KEY not set"

Ensure the environment variable is available in the VS Code process. Restart VS Code after setting it.

### "No workspace folder open"

Open a project folder first (File > Open Folder).

### "PowerShell script not found"

Ensure `scripts/pr-helper/New-PrRequest.ps1` exists relative to the MasonDevTools root.

### Extension doesn't compile

```powershell
cd extensions/mason-pr-helper
npm install
npm run compile
```

Check for TypeScript errors in the Problems panel.
