#!/bin/bash

RECIPIENT=$1
OBJECT=$2

echo "{\"to\": \"$RECIPIENT\", \"object\": \"$OBJECT\"}"  DEBUG=*tradle* ./node_modules/.bin/serverless invoke local -f send
