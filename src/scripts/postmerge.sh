#!/bin/bash

set -euo pipefail

changed_files="$(git diff-tree -r --name-only --no-commit-id ORIG_HEAD HEAD)"
check_run() {
  echo "$changed_files" | grep --quiet "$1" && eval "$2"
}

update_deps() {
  echo 'dependencies have changed, running "npm install"'
  npm install
}

check_run npm-shrinkwrap.json "update_deps"
echo 'compiling typescript' && tsc
