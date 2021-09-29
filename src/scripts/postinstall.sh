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

mkdir -p "$(dirname $0)/../../lib/"

echo "Fixing secp256k1, as it is not binary compatible with node14 and the log statements cause errors."
sed -i -e  "s/console.error('Secp256k1 bindings are not compiled. Pure JS implementation will be used.')//g" ./node_modules/secp256k1/index.js

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
./node_modules/.bin/sls slstats --disable
