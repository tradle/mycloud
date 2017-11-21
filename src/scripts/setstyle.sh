#!/bin/sh

cat ./srx/samplebot/conf/provider.json | jq .style | sls invoke -f bot_setstyle
