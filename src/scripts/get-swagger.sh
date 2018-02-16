#!/bin/bash

API_ID=$(cat "./src/cli/remote-service-map.json" | jq .R_RESTAPI_ApiGateway --raw-output)
STAGE=$(cat "./src/cli/remote-service-map.json" | jq .SERVERLESS_STAGE --raw-output)
aws apigateway get-export --rest-api-id "$API_ID" --stage-name "$STAGE" --export-type swagger --accepts application/yaml  --parameters extensions='integrations' swagger.yml
