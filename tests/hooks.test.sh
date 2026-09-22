#!/bin/sh
# Exercises the real hooks in a throwaway repo. Run: sh tests/hooks.test.sh
set -e
BUNDLE="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
check() {
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1)); echo "  ok   $1"
  else
    FAIL=$((FAIL + 1)); echo "  FAIL $1 (expected exit $3, got $2)"
  fi
}
stamp() {
  printf '{"tree":"%s","result":"pass","rulesHash":"%s","createdAt":"%s"}' \
    "$1" "$RULES_HASH" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ".git/guardrails/stamps/$1.json"
}

WORK="$(mktemp -d)"
cd "$WORK"
git init -q -b main
git config user.email t@t
git config user.name t
mkdir -p .claude backend frontend .git/guardrails/stamps
cp -r "$BUNDLE" .claude/guardrails
git config core.hooksPath .claude/guardrails/githooks
git config branch.main.asanaTask 1218492088693885
RULES_HASH="$(cd .claude/guardrails && node -e "import('./scripts/lib/stamp.mjs').then(m=>console.log(m.rulesHash()))")"

echo "gate"
echo "x" > frontend/a.ts
git add frontend/a.ts
set +e
git commit -q -m "chore(fe): touch a file"; check "frontend-only commit is allowed" "$?" "0"

echo "class A {}" > backend/A.cs
git add backend/A.cs
git commit -q -m "feat(be): add A"; check "backend commit with no stamp is blocked" "$?" "1"

stamp "$(git write-tree)"
git commit -q -m "feat(be): add A

A is the first class this repo has ever had."; check "backend commit with a passing stamp is allowed" "$?" "0"

echo "class B {}" > backend/B.cs
git add backend/B.cs
TREE2="$(git write-tree)"
printf '{"tree":"%s","result":"pass","rulesHash":"stale","createdAt":"%s"}' \
  "$TREE2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ".git/guardrails/stamps/$TREE2.json"
git commit -q -m "feat(be): add B

B follows A."; check "a stamp from older rules is refused" "$?" "1"

echo "commit message rules"
git reset -q HEAD -- backend/B.cs
rm -f backend/B.cs
echo "class C {}" > backend/C.cs
git add backend/C.cs
stamp "$(git write-tree)"

git commit -q -m "added stuff"; check "a non-conventional header is refused" "$?" "1"
git commit -q -m "feat(be): add C"; check "a header with no body is refused" "$?" "1"
git commit -q -m "feat(be): add C

Co-Authored-By: Claude <noreply@anthropic.com>"; check "attribution is refused" "$?" "1"
git commit -q -m "feat(be): add C

C is needed because B could not carry the flag."; check "a good message is accepted" "$?" "0"

echo "the Asana trailer"
echo "class D {}" > backend/D.cs
git add backend/D.cs
stamp "$(git write-tree)"
git commit -q -m "feat(be): add D

D exists so the trailer has something to attach to."
git log -1 --format=%B | grep -q "Asana: .*1218492088693885"; check "the trailer was appended from the branch link" "$?" "0"

echo "an unlinked branch"
git config --unset branch.main.asanaTask
echo "class E {}" > backend/E.cs
git add backend/E.cs
stamp "$(git write-tree)"
git commit -q -m "feat(be): add E

E is here to prove an unlinked branch is refused."
UNLINKED=$?
git config branch.main.asanaTask 1218492088693885
if grep -q '"requireTicket": true' .claude/guardrails/config.json; then
  check "a backend commit on an unlinked branch is blocked" "$UNLINKED" "1"
else
  check "an unlinked branch is allowed while requireTicket is off" "$UNLINKED" "0"
fi
set -e

echo
echo "passed: $PASS   failed: $FAIL"
cd /
rm -rf "$WORK"
[ "$FAIL" -eq 0 ]
