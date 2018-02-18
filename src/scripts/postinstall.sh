#!/bin/bash

files=( "vars" "secrets" )

for file in "${files[@]}"
do
  if [ ! -e "$file.yml" ] && [ -e "templates/$file.yml" ]; then
    echo "creating $file.yml"
    cp "templates/$file.yml" "$file.yml"
  fi
done

# if [ ! -e "src/samplebot/conf/provider.json" ]; then
#   echo "creating src/samplebot/conf/provider.json"
#   cp "src/samplebot/conf/default.json" "src/samplebot/conf/provider.json"
# fi

if [ ! -e "serverless.yml" ]; then
  echo "copying placeholder serverless.yml"
  cp serverless-uncompiled.yml serverless.yml
fi

tsc
npm run copy-static-assets
npm run build:yml
