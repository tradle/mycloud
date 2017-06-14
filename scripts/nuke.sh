#!/bin/sh

read -p "This will empty and delete all buckets, tables, lambdas, etc. Are you sure? " -n 1 -r
echo    # (optional) move to a new line
if [[ $REPLY =~ ^[Yy]$ ]]
then
    # do dangerous stuff
  echo "emptying buckets"
  aws s3 rb s3://tradle-messaging-dev-objects --force
  aws s3 rb s3://tradle-messaging-dev-secrets --force
  aws s3 rb s3://tradle-messaging-dev-public-conf --force
  aws s3 rb s3://tradle-messaging-dev-private-conf --force

  echo "removing all of serverless's hard work"
  sls remove
fi
