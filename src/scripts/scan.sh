#!/bin/bash

TABLE="$1"
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

if [ "$ENDPOINT" == "" ]; then
  echo "scanning remote db"
else
  echo "scanning local db"
fi

eval "aws dynamodb scan --table-name $TABLE $ENDPOINT" | ./lib/scripts/unmarshal.js
