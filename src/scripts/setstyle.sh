#!/bin/sh

if [ "$IS_LOCAL" ]
then
  cat ./src/samplebot/conf/provider.json | jq .public.style | sls invoke local -f bot_setstyle
else
  cat ./src/samplebot/conf/provider.json | jq .public.style | sls invoke -f bot_setstyle
fi
