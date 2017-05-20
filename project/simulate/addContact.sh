#!/bin/bash

export SLS_DEBUG=*
export DEBUG=tradle*
export IS_LOCAL=1

aws s3api put-object \
  --endpoint-url http://localhost:4572 \
  --bucket tradle-messaging-dev-objects1 \
  --key ef78b341f079cf4245faf23e79058992a337313080b264d476c7952d37d32462 \
  --body ./test/fixtures/bob/object.json

echo '{"link":"ef78b341f079cf4245faf23e79058992a337313080b264d476c7952d37d32462"}' | sls invoke local -f addcontact
