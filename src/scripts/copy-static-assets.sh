#!/bin/bash

cp src/*.json lib/
cp src/cli/*.json lib/cli/
cp src/test/*.json lib/test/
cp -r src/test/fixtures lib/test/
cp src/samplebot/*.json lib/samplebot/

mkdir -p lib/samplebot/conf
cp src/samplebot/conf/*.json lib/samplebot/conf/

chmod +x lib/scripts/*.js
