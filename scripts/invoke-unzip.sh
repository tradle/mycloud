#!/bin/sh

set -x
sls invoke $@ | jq .body --raw-output | base64 --decode | gunzip
