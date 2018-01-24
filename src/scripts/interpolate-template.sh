#!/bin/bash

VALUE=$(sls print "$@")
if [ "$?" == "0" ]; then
  echo "$VALUE" > serverless-interpolated.yml
  cat serverless-interpolated.yml | ./src/scripts/yaml2json.js > src/serverless-interpolated.json
  cp src/serverless-interpolated.json lib/
else
  >&2 echo "$VALUE"
fi
