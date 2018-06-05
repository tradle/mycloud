#!/bin/bash

set -euo pipefail
tsc
npm run eslint
npm run build:yml
npm run clean:node_modules
