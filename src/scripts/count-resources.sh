#!/bin/bash

BY_TYPE="$(cat .serverless/cloudformation-template-update-stack.json | jq '.Resources[] .Type' | sort | uniq -c | sort -r)"
TOTAL="$(echo "$BY_TYPE" | awk '{ print $1 }' | paste -sd+ | bc)"

echo "$BY_TYPE"
echo "Total: $TOTAL"
