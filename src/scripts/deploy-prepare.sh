#!/bin/bash

set -euo pipefail
if [[ $(git diff --stat) != '' ]] || [[ $(git diff --staged --stat) != '' ]]; then
  echo 'please stash or commit before deploying'
  exit 1
fi

tsc
npm run eslint
npm run build:yml
npm run clean:node_modules
