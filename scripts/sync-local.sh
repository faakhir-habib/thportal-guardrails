#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUNDLE="$ROOT/.claude/guardrails"

mkdir -p "$ROOT/.claude/agents" "$ROOT/.claude/skills/thportal-review"

[ -f "$BUNDLE/agents/architecture-reviewer.md" ] && \
  cp "$BUNDLE/agents/architecture-reviewer.md" "$ROOT/.claude/agents/architecture-reviewer.md"
[ -f "$BUNDLE/skills/thportal-review/SKILL.md" ] && \
  cp "$BUNDLE/skills/thportal-review/SKILL.md" "$ROOT/.claude/skills/thportal-review/SKILL.md"
[ -f "$BUNDLE/claude/CLAUDE.root.md" ] && cp "$BUNDLE/claude/CLAUDE.root.md" "$ROOT/CLAUDE.md"
[ -f "$BUNDLE/claude/CLAUDE.backend.md" ] && cp "$BUNDLE/claude/CLAUDE.backend.md" "$ROOT/backend/CLAUDE.md"

echo "synced into $ROOT"
