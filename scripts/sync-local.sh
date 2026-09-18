#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUNDLE="$ROOT/.claude/guardrails"

# Claude Code loads agents and skills from the .claude/ of the directory the session starts in, and
# developers start in both the repo root and backend/, so both get a copy.
for BASE in "$ROOT/.claude" "$ROOT/backend/.claude"; do
  mkdir -p "$BASE/agents" "$BASE/skills/thportal-review"
  [ -f "$BUNDLE/agents/architecture-reviewer.md" ] && \
    cp "$BUNDLE/agents/architecture-reviewer.md" "$BASE/agents/architecture-reviewer.md"
  [ -f "$BUNDLE/skills/thportal-review/SKILL.md" ] && \
    cp "$BUNDLE/skills/thportal-review/SKILL.md" "$BASE/skills/thportal-review/SKILL.md"
done

[ -f "$BUNDLE/claude/CLAUDE.root.md" ] && cp "$BUNDLE/claude/CLAUDE.root.md" "$ROOT/CLAUDE.md"
[ -f "$BUNDLE/claude/CLAUDE.backend.md" ] && cp "$BUNDLE/claude/CLAUDE.backend.md" "$ROOT/backend/CLAUDE.md"

# backend/.claude is not covered by the repo's .gitignore, so the copies there are hidden per clone.
EXCLUDE="$ROOT/.git/info/exclude"
for LINE in "/CLAUDE.md" "/backend/CLAUDE.md" "/backend/.claude/agents/" "/backend/.claude/skills/thportal-review/"; do
  grep -qxF "$LINE" "$EXCLUDE" 2>/dev/null || printf '%s\n' "$LINE" >> "$EXCLUDE"
done

echo "synced into $ROOT (root and backend). Restart Claude Code to register the agent and skill."
