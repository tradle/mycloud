#!/bin/bash

cat serverless-interpolated.yml | ./src/scripts/yaml2json.sh | jq .$1 --raw-output
