#!/bin/bash

set -euo pipefail

npm run gen:testenv
npm run warmup

MAKE_PUBLIC=$(cat ./vars.yml | ./lib/scripts/yaml2json.js | jq .public --raw-output)
if [ "$MAKE_PUBLIC" == "true" ]; then
  echo "making deployment bucket public, as specified in vars.yml"
  npm run makepublic
fi
