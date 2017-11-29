#!/bin/bash

RECIPIENT=$1
MESSAGE=$2

echo "{\"to\": \"$RECIPIENT\", \"object\": \"$MESSAGE\"}"  DEBUG=*tradle* ./node_modules/.bin/serverless invoke local -f send
