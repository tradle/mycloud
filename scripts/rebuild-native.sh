#!/bin/sh

NATIVE=$(./scripts/get-native-prod-modules.js)
if [ "$?" == "0" ]; then
  set -x
  npm rebuild $NATIVE
fi
