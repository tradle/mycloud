#!/bin/bash

echo "[interpolate-template.sh] Generating required version info."
npm run gen:versioninfo

echo ""
echo "[interpolate-template.sh] Collecting '$@' using 'sls print'"
VALUE=$(./node_modules/.bin/sls print "$@")
if [ "$?" == "0" ]; then
  echo ""
  echo "[interpolate-template.sh] Writing serverless-interpolated.yml"
  echo "$VALUE" > serverless-interpolated.yml
  echo "[interpolate-template.sh] Writing src/serverless-interpolated.json"
  cat serverless-interpolated.yml | node ./lib/scripts/yaml2json.js > src/serverless-interpolated.json
  echo "[interpolate-template.sh] Writing lib/serverless-interpolated.json"
  cp src/serverless-interpolated.json lib/
else
  echo "[interpolate-template.sh] Writing to stderr"
  >&2 echo "$VALUE"
fi
