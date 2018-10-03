#!/bin/bash

native_list=$(mktemp)
npm ls --production --parseable=true --long=false --silent | node $(dirname $0)/../../lib/scripts/filter-native-modules.js --output "$native_list"
echo $(cat "$native_list")
rm -f "$native_list"
