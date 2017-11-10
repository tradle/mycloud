#!/bin/bash

VALUE=$(sls print "$@")
if [ "$?" == "0" ]; then
  echo "$VALUE" > serverless-interpolated.yml
else
  >&2 echo "$VALUE"
fi
