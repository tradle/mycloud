#!/bin/sh

cat serverless-interpolated.yml | ./scripts/yaml2json.sh | jq .$1 --raw-output
