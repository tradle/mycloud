#!/bin/bash

TABLE="$1"
if [ -z "$TABLE" ]; then
  echo 'expected table name as first parameter'
  exit 1
fi

ENDPOINT="--endpoint-url http://localhost:4569"

while getopts remote: opt; do
  case $opt in
  remote)
      ENDPOINT=
      ;;
  *)
      ;;
  esac
done

# if [ "$ENDPOINT" == "" ]; then
#   echo "scanning remote table: $TABLE"
# else
#   echo "scanning local table: $TABLE"
# fi

eval "aws dynamodb scan --table-name $TABLE $ENDPOINT" | ./lib/scripts/unmarshal.js
