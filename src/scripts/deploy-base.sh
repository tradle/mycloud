#!/bin/bash

set -euo pipefail
SLS_DEBUG=* IS_LOCAL= node  ./lib/scripts/deploy.js
npm run deploy:postprocess
