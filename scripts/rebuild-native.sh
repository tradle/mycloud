#!/bin/sh

NATIVE=$(./scripts/get-native-prod-modules.js)
set -x
npm rebuild $NATIVE
