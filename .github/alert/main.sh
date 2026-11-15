#!/usr/bin/env bash
set -euo pipefail

title="$WORKFLOW fails on main"
commit="${GITHUB_SHA:0:12}"

open_issue="$(gh issue list --repo "$GH_REPO" --state open --search "\"$title\" in:title" --json number,title,author --limit 50 |
  jq --raw-output --arg title "$title" '[.[] | select(.title == $title and .author.login == "app/github-actions")][0].number // empty')"

posted() {
  if [ -z "${ALERT_WEBHOOK_URL:-}" ]; then
    echo "CI_ALERT_WEBHOOK_URL is not set, so the issue is the only alert."
    return 0
  fi
  jq --null-input --compact-output --arg text "$1" '{text: $text}' |
    curl --fail --silent --show-error --max-time 20 --retry 3 --header 'content-type: application/json' \
      --data @- --output /dev/null "$ALERT_WEBHOOK_URL"
}

case "$OUTCOME" in
  failure | cancelled)
    said="$GH_REPO: $WORKFLOW failed on main at $commit. $RUN_URL"
    if [ -n "$open_issue" ]; then
      gh issue comment "$open_issue" --repo "$GH_REPO" --body "$WORKFLOW failed again at $GITHUB_SHA: $RUN_URL"
      echo "Added the failure to issue #$open_issue."
    else
      body="$WORKFLOW failed on main at $GITHUB_SHA: $RUN_URL

This issue stays open while $WORKFLOW fails on main, gathers each further failure as a comment, and is closed by the first run of $WORKFLOW that passes on main."
      if [ -n "${ASSIGNEES:-}" ] && gh issue create --repo "$GH_REPO" --title "$title" --body "$body" --assignee "$ASSIGNEES"; then
        echo "Opened the issue, assigned to $ASSIGNEES."
      else
        gh issue create --repo "$GH_REPO" --title "$title" --body "$body"
        echo "Opened the issue."
      fi
    fi
    posted "$said"
    ;;
  success)
    if [ -z "$open_issue" ]; then
      echo "$WORKFLOW passes on main and no issue says otherwise."
      exit 0
    fi
    gh issue close "$open_issue" --repo "$GH_REPO" --comment "$WORKFLOW passes on main again at $GITHUB_SHA: $RUN_URL"
    echo "Closed issue #$open_issue."
    posted "$GH_REPO: $WORKFLOW passes on main again at $commit. $RUN_URL"
    ;;
  *)
    echo "$WORKFLOW ended $OUTCOME on main, which is neither a failure nor a pass, so nothing is said."
    ;;
esac
