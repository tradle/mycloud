#!/bin/bash

set -x

MODULES=(
  "aws-client-factory"
  "aws-common-utils"
  "aws-s3-client"
  "aws-sns-client"
  "aws-iam-client"
  "aws-lambda-client"
  "aws-cloudwatch-client"
  "aws-cloudformation-client"
  "aws-combo"
)

VERSION=${1:-latest}
for item in ${MODULES[*]}
do
  if [[ $VERSION = "local" ]]
  then
    npm i -S "../../tradle-aws/packages/$item"
  elif [[ $VERSION = "link" ]]
  then
    npm link "@tradle/$item"
  else
    npm i -S "@tradle/$item@$VERSION"
  fi
done
