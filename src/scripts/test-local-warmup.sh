#!/bin/bash

set -euo pipefail

FUNCTIONS=$(cat serverless-uncompiled.yml | \
  ./src/scripts/yaml2json.sh | \
  jq '.functions | keys | .[]' --raw-output |
  grep -v "_dev$")

echo "faking warming up: $(echo $FUNCTIONS | xargs)"

for fn in $FUNCTIONS;
do
  echo "warming up $fn"
  echo '{"source": "warmup"}' | ./node_modules/.bin/sls invoke local -f "$fn"
done
