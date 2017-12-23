#!/bin/sh

NATIVE=$(npm ls --production --parseable=true --long=false --silent | node ./lib/scripts/filter-native-modules.js)
echo "rebuilding: $NATIVE"
npm rebuild $NATIVE
