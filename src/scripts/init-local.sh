#!/bin/bash

# pity to waste time on this, but you can't expect the dev to remember to run this
npm run build:yml
npm run gen:localstack
sleep 6
echo "{\"RequestType\": \"Create\", \"ResourceProperties\": $(cat ./src/serverless-interpolated.json | jq .custom.org --raw-output -c)}" | node --debug --inspect $(which sls) invoke local -f bot_oninit
