#!/bin/bash

cp src/*.json lib/
cp src/cli/*.json lib/cli/
cp src/test/*.json lib/test/
cp -r src/test/fixtures lib/test/
cp src/samplebot/*.json lib/samplebot/
chmod +x lib/scripts/*.js
