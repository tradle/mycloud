#!/bin/bash

TABLE="$1"

aws dynamodb scan --table-name "$TABLE" --endpoint-url http://localhost:4569 | ./project/scripts/unmarshal.js
