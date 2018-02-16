#!/bin/bash

set -euo pipefail

docker ps >/dev/null 2>&1 || { echo 'please start Docker first'; exit 1; }

npm run localstack:start
sleep 5
# npm run gen:localresources
DEBUG=λ*,*tradle* serverless offline start
