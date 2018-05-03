#!/bin/sh

set -euo pipefail

native_list=$(mktemp)
npm ls --production --parseable=true --long=false --silent | node ./lib/scripts/filter-native-modules.js --output "$native_list"
NATIVE=$(cat "$native_list")
echo "rebuilding: $NATIVE"
npm rebuild $NATIVE
rm -f "$native_list"
