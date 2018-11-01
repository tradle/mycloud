#!/bin/bash

# pity to waste time on this, but you can't expect the dev to remember to run this
npm run build:yml
npm run gen:localstack
sleep 6
node $(dirname $0)/../../lib/scripts/get-custom-resource-create-event.js | DEBUG="*lambda*,tradle*" node ./node_modules/.bin/sls invoke local -f bot_oninit
