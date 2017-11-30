#!/bin/bash

VALUE=$(sls print "$@")
if [ "$?" == "0" ]; then
  echo "$VALUE" > serverless-interpolated.yml
  cat serverless-interpolated.yml | ./src/scripts/yaml2json.js > lib/serverless-interpolated.json
else
  >&2 echo "$VALUE"
fi
