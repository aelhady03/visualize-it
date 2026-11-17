#!/usr/bin/env bash
# Lane scope guard. Fails if this branch changed any file outside the allowed
# glob patterns (compared against main via `git diff --name-only main...HEAD`).
#
# Usage:   scripts/check-scope.sh '<glob>' ['<glob>' ...]
# Example: scripts/check-scope.sh 'src/modules/sstable/**'
#          scripts/check-scope.sh 'src/core/player/**' 'src/core/player.test.ts'
#
# Globs are matched against repo-relative paths (converted to anchored regexes):
# `*` matches within one path segment, `**` across segments, `?` one character.
# QUOTE your globs so the shell does not expand them.
# Override the base branch with BASE=<ref> (default: main).
# Only committed changes are checked — commit before running.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 '<glob>' ['<glob>' ...]" >&2
  exit 2
fi

base="${BASE:-main}"
if ! git rev-parse --verify --quiet "$base" >/dev/null; then
  echo "check-scope: base ref '$base' not found" >&2
  exit 2
fi

# Convert a glob to an anchored ERE: '**/' -> any dirs (incl. none), '**' -> anything,
# '*' -> anything but '/', '?' -> one non-'/' char. Other regex chars are escaped.
glob_to_regex() {
  local glob="$1" out="" i c next
  for ((i = 0; i < ${#glob}; i++)); do
    c="${glob:i:1}"
    next="${glob:i+1:1}"
    if [ "$c" = "*" ] && [ "$next" = "*" ]; then
      if [ "${glob:i+2:1}" = "/" ]; then
        out+="(.*/)?"
        i=$((i + 2))
      else
        out+=".*"
        i=$((i + 1))
      fi
    elif [ "$c" = "*" ]; then
      out+="[^/]*"
    elif [ "$c" = "?" ]; then
      out+="[^/]"
    elif [[ "$c" =~ [.+^\$\(\)\|\{\}\[\]\\] ]]; then
      out+="\\$c"
    else
      out+="$c"
    fi
  done
  printf '^%s$' "$out"
}

regexes=()
for g in "$@"; do
  regexes+=("$(glob_to_regex "$g")")
done

changed="$(git diff --name-only "$base"...HEAD)"
if [ -z "$changed" ]; then
  echo "check-scope: no changes vs $base"
  exit 0
fi

status=0
while IFS= read -r file; do
  if [ "$file" = "PLAN.md" ]; then
    echo "check-scope: WARNING: PLAN.md is modified on this branch — only the plan owner may edit it" >&2
  fi
  matched=0
  for re in "${regexes[@]}"; do
    if [[ "$file" =~ $re ]]; then
      matched=1
      break
    fi
  done
  if [ "$matched" -eq 0 ]; then
    echo "check-scope: OUT OF SCOPE: $file" >&2
    status=1
  fi
done <<<"$changed"

if [ "$status" -eq 0 ]; then
  echo "check-scope: OK — $(printf '%s\n' "$changed" | wc -l | tr -d ' ') changed file(s), all in scope"
else
  echo "check-scope: FAILED — allowed patterns: $*" >&2
fi
exit "$status"
