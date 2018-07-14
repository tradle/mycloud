#!/bin/bash

set -euo pipefail
if [[ $ALLOW_DIRTY != "1" ]]; then
  if [[ $(git diff --stat) != '' ]] || [[ $(git diff --staged --stat) != '' ]]; then
    echo 'please stash or commit before deploying'
    exit 1
  fi
fi

npm run clean:lib
tsc
npm run eslint
npm run build:yml
npm run clean:node_modules
