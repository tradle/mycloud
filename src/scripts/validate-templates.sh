#!/bin/bash

# source:
# https://github.com/aws-samples/ecs-refarch-cloudformation/blob/master/tests/validate-templates.sh

source "$(dirname "$0")/env.sh"

ERROR_COUNT=0;
CF_DIR="$(dirname $0)/../../cloudformation"

echo "Validating AWS CloudFormation templates..."

# Loop through the YAML templates in this repository
# TODO: validate in parallel
for TEMPLATE in $(find "$CF_DIR" -name '*.yml'); do

  # Validate the template with CloudFormation
  ERRORS=$(aws cloudformation validate-template --template-body file://$TEMPLATE 2>&1 >/dev/null);
  if [ "$?" -gt "0" ]; then
    ((ERROR_COUNT++));
    echo "[fail] $TEMPLATE: $ERRORS";
  else
    echo "[pass] $TEMPLATE";
  fi;

done;

echo "$ERROR_COUNT template validation error(s)";
if [ "$ERROR_COUNT" -gt 0 ];
  then exit 1;
fi
