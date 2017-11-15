#!/bin/bash

files=( "vars" "secrets" )

for file in "${files[@]}"
do
  if [ ! -e "$file.yml" ] && [ -e "$file-template.yml" ]; then
    echo "creating $file.yml"
    cp "$file-template.yml" "$file.yml"
  fi
done

if [ ! -e "conf/provider.json" ]; then
  echo "creating conf/provider.json"
  cp "conf/provider-sample.json" "conf/provider.json"
fi

if [ ! -e "serverless.yml" ]; then
  echo "copying placeholder serverless.yml"
  cp serverless-uncompiled.yml serverless.yml
fi

npm run build:yml
