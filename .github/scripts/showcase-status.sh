#!/usr/bin/env bash
# Posts the showcase submission status comment, or edits the existing one so reruns
# never stack comments. Reads the body from stdin; needs GH_TOKEN, GH_REPO and ISSUE.
set -euo pipefail

MARKER='<!-- showcase-submit -->'
BODY="$MARKER"$'\n'"$(cat)"

CID=$(gh api "repos/$GH_REPO/issues/$ISSUE/comments" \
  --jq "[.[] | select(.body | startswith(\"$MARKER\"))][0].id // empty")

if [ -n "$CID" ]; then
  gh api --method PATCH "repos/$GH_REPO/issues/comments/$CID" -f body="$BODY" >/dev/null
else
  printf '%s' "$BODY" | gh issue comment "$ISSUE" --body-file -
fi
