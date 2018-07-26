#!/bin/bash

EVENT="{\"RequestType\":\"UpdateConf\",\"ResourceProperties\":{}}"

# set -x
if [ "$IS_LOCAL" ]
then
  echo "$EVENT" | ./node_modules/.bin/sls invoke local -f bot_oninit
else
  echo "$EVENT" | ./node_modules/.bin/sls invoke -f bot_oninit
fi
