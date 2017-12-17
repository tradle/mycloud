#!/bin/bash

cd src &&
find . -type f \( -name "*.json" -o -name "*.js" \) -exec rsync -R \{\} ../lib \; &&
cd ..

chmod +x lib/scripts/*.js
