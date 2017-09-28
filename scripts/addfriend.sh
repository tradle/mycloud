#!/bin/bash
name=
url=
stage=

while getopts n:u:s: opt; do
  case $opt in
  u)
      url=$OPTARG
      ;;
  n)
      name=$OPTARG
      ;;
  s)
      stage=$OPTARG
      ;;
  *)
      exit 1
      ;;
  esac
done

if [ -z "$stage" ] || [ -z "name" ] || [ -z "url" ]; then
  # stage=$(./scripts/var.js custom.stage)
  echo '"name", "url" and "stage" are required'
  exit 1
fi

set -x
echo "{\"name\": \"$name\", \"url\": \"$url\"}" | sls invoke --stage=$stage -f addfriend
