#!/usr/bin/env bash
# Codex environment setup — runs automatically before each session.
# Creates a paired branch + worktree so HEAD is never detached.

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
WORKTREES_PARENT="$(dirname "$REPO_ROOT")"

# ── Detect or create the working branch ──────────────────────────────────────
# Codex may pass a branch name via CODEX_BRANCH or derive one from the task.
BRANCH="${CODEX_BRANCH:-}"

if [ -z "$BRANCH" ]; then
  # Fall back: use the current branch if not detached, else error.
  CURRENT="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
  if [ "$CURRENT" = "HEAD" ] || [ -z "$CURRENT" ]; then
    echo "ERROR: Detached HEAD detected and no CODEX_BRANCH set." >&2
    echo "Re-run with CODEX_BRANCH=<branch-name> or check out a branch first." >&2
    exit 1
  fi
  BRANCH="$CURRENT"
fi

# ── Ensure the branch exists (create from master if new) ─────────────────────
if ! git -C "$REPO_ROOT" rev-parse --verify "refs/heads/$BRANCH" > /dev/null 2>&1; then
  echo "Branch '$BRANCH' does not exist — creating from master."
  git -C "$REPO_ROOT" branch "$BRANCH" master
fi

# ── Ensure a worktree is linked to this branch ───────────────────────────────
WORKTREE_PATH="$WORKTREES_PARENT/MasonDevTools-$(echo "$BRANCH" | tr '/' '-')"

EXISTING_WT="$(git -C "$REPO_ROOT" worktree list --porcelain \
  | awk '/^worktree /{wt=$2} /^branch refs\/heads\/'$BRANCH'$/{print wt}' \
  || true)"

if [ -n "$EXISTING_WT" ]; then
  echo "Worktree for '$BRANCH' already exists at: $EXISTING_WT"
  WORKTREE_PATH="$EXISTING_WT"
else
  echo "Creating worktree for '$BRANCH' at: $WORKTREE_PATH"
  git -C "$REPO_ROOT" worktree add "$WORKTREE_PATH" "$BRANCH"
fi

# ── Install dependencies in the extension folder ─────────────────────────────
EXT_DIR="$WORKTREE_PATH/extensions/pr-forge"
if [ -f "$EXT_DIR/package.json" ]; then
  echo "Installing npm dependencies in $EXT_DIR"
  npm --prefix "$EXT_DIR" install --prefer-offline --no-audit --no-fund 2>&1 | tail -3
fi

echo ""
echo "✓ Setup complete."
echo "  Branch  : $BRANCH"
echo "  Worktree: $WORKTREE_PATH"
echo "  Run 'cd $EXT_DIR' to start work."
