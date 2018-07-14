#!/bin/bash

set -euo pipefail
if [[ -z ${ALLOW_DIRTY+x} ]]; then
  if [[ $(git diff --stat) != '' ]] || [[ $(git diff --staged --stat) != '' ]]; then
    echo 'please stash or commit before deploying'
    exit 1
  fi
fi

npm run clean:lib
npm run build
npm run eslint
npm run clean:node_modules
