#!/bin/bash

set -x
# set -euo pipefail

source "$(dirname $0)/env.sh"

if [[ ! "$S3_TEMPLATES_PATH" ]]
then
  exit 0
fi

$(dirname $0)/validate-templates.sh

aws s3 cp \
  --recursive "$(pwd)/cloudformation/" "s3://$S3_TEMPLATES_PATH/" \
  --acl public-read \
  --exclude "*" \
  --include "*.yml"
