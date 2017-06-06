#!/bin/bash

aws dynamodb create-table \
  --endpoint-url=http://localhost:4569 \
  --cli-input-json file://conf/pub-keys-table-schema.json

aws dynamodb create-table \
  --endpoint-url=http://localhost:4569 \
  --cli-input-json file://conf/events-table-schema.json

aws dynamodb create-table \
  --endpoint-url=http://localhost:4569 \
  --cli-input-json file://conf/inbox-table-schema.json

aws dynamodb create-table \
  --endpoint-url=http://localhost:4569 \
  --cli-input-json file://conf/outbox-table-schema.json

aws dynamodb create-table \
  --endpoint-url=http://localhost:4569 \
  --cli-input-json file://conf/presence-table-schema.json

aws s3api create-bucket \
  --endpoint-url=http://localhost:4572 \
  --bucket tradle-messaging-dev-objects1

aws s3api create-bucket \
  --endpoint-url=http://localhost:4572 \
  --bucket tradle-messaging-dev-secrets1
