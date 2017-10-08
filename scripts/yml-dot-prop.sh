#!/bin/sh

cat serverless.yml | ./scripts/yaml2json.sh | jq .$1 --raw-output
