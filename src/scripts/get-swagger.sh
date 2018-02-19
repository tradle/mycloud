#!/bin/bash

API_ID=$(cat "./src/cli/remote-service-map.json" | jq .R_RESTAPI_ApiGateway --raw-output)
STAGE=$(cat "./src/cli/remote-service-map.json" | jq .SERVERLESS_STAGE --raw-output)
PROFILE=$(cat "./lib/serverless-interpolated.json" | jq .provider.profile --raw-output)

if [ "$PROFILE" == "null" ]; then
  PROFILE="default"
fi

aws --profile "$PROFILE" apigateway get-export --rest-api-id "$API_ID" --stage-name "$STAGE" --export-type swagger --accepts application/yaml  --parameters extensions='integrations' swagger.yml
