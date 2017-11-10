#!/bin/sh

SERVICE=$(./src/scripts/yml-dot-prop.sh service)
cat "./conf/$SERVICE.json" | jq .style | sls invoke -f setstyle
