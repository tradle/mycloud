#!/bin/bash

changed_files="$(git diff-tree -r --name-only --no-commit-id ORIG_HEAD HEAD)"
check_run() {
  echo "$changed_files" | grep -E --quiet "$1" && eval "$2"
}

update_deps() {
  echo 'dependencies have changed, running "npm install"'
  npm install
}

rebuild_yml() {
  echo 'serverless-uncompiled.yml has changed, recompiling'
  npm run build:yml
}

check_run npm-shrinkwrap.json "update_deps"
check_run serverless-uncompiled.yml "rebuild_yml"

echo 'compiling typescript' && tsc
