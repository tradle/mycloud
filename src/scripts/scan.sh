#!/bin/bash

TABLE="$1"
if [ -z "$TABLE" ]; then
  echo 'expected table name as first parameter'
  exit 1
fi

PREFIX=$(cat ./src/serverless-interpolated.json | jq .custom.prefix --raw-output -c)
TABLE="$PREFIX$TABLE"

if [ "$IS_LOCAL" ]; then
  ENDPOINT="--endpoint-url http://localhost:4569"
else
  ENDPOINT=""
fi

while getopts remote: opt; do
  case $opt in
  remote)
      ENDPOINT=
      ;;
  *)
      ;;
  esac
done

if [ "$ENDPOINT" == "" ]; then
  echo "scanning remote table: $TABLE"
else
  echo "scanning local table: $TABLE"
fi

eval "aws dynamodb scan --table-name $TABLE $ENDPOINT" | node ./lib/scripts/unmarshal.js
