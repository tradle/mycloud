#!/bin/bash

files=( "vars" )

for file in "${files[@]}"
do
  if [ ! -e "$file.json" ] && [ -e "templates/$file.json" ]; then
    echo "creating $file.json"
    cp "templates/$file.json" "$file.json"
  fi
done

# if [ ! -e "src/in-house-bot/conf/provider.json" ]; then
#   echo "creating src/in-house-bot/conf/provider.json"
#   cp "src/in-house-bot/conf/default.json" "src/in-house-bot/conf/provider.json"
# fi

if [ ! -e "serverless.yml" ]; then
  echo "copying placeholder serverless.yml"
  cp serverless-uncompiled.yml serverless.yml
fi

mkdir -p "$(dirname $0)/../../lib/"

if ! [ -x "$(command -v tsc)" ]; then
  echo 'Error: typescript is not installed' >&2
  echo 'Run: npm i -g --save-exact typescript@2.8.4' >&2
  echo 'Hint: you may need sudo' >&2
  exit 1
fi

# npm run clean:deps

tsc
npm run copy-static-assets
npm run gen:versioninfo
npm run build:yml
