#!/bin/bash

set -x

VERSION=${1:-latest}
npm i -S @tradle/aws-client-factory@$VERSION \
  @tradle/aws-common-utils@$VERSION \
  @tradle/aws-s3-client@$VERSION \
  @tradle/aws-sns-client@$VERSION \
  @tradle/aws-lambda-client@$VERSION \
  @tradle/aws-cloudwatch-client@$VERSION \
  @tradle/aws-cloudformation-client@$VERSION \
  @tradle/aws-combo@$VERSION

