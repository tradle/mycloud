#!/bin/bash

RESP=$(sls invoke $@)
STATUS=$(echo $RESP | jq .statusCode --raw-output)
BODY=$(echo $RESP | jq .isBase64Encoded --raw-output)
DECODE=$()
if [ "$STATUS" == "200" ] && [ "$DECODE" == "true" ]; then
  echo $RESP | jq .body --raw-output | base64 --decode | gunzip | jq
else
  echo $RESP | jq
fi
