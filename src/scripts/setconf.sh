#!/bin/sh

CONF=$(cat ./src/samplebot/conf/provider.json)

# set -x
if [ "$IS_LOCAL" ]
then
  echo "{\"RequestType\":\"SetConf\",\"ResourceProperties\":$CONF}" | sls invoke local -f bot_oninit
else
  echo "{\"RequestType\":\"SetConf\",\"ResourceProperties\":$CONF}" | sls invoke -f bot_oninit
fi
