#!/bin/bash

set -euo pipefail

npm run gen:testenv
rm -rf node_modules/sharp
npm i sharp
