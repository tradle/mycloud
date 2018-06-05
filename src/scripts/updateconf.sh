#!/bin/bash

EVENT="{\"RequestType\":\"UpdateConf\",\"ResourceProperties\":{}}"

# set -x
if [ "$IS_LOCAL" ]
then
  echo "$EVENT" | sls invoke local -f bot_oninit
else
  echo "$EVENT" | sls invoke -f bot_oninit
fi
