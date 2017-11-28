#!/bin/bash

cd src &&
find . -type f \( -name "*.json" -o -name "*.js" \) -exec cp --parents \{\} ../lib \; &&
cd ..

chmod +x lib/scripts/*.js
