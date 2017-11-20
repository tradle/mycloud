#!/bin/sh

cat ./conf/provider.json | jq .style | sls invoke -f bot_setstyle
