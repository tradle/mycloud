#!/bin/bash

# export AWS_PROFILE=mv
# export S3_TEMPLATES_PATH=mvayngrib-serverless-deployment/mycloud/templates

# export AWS_PROFILE=default
# export S3_TEMPLATES_PATH=tradle-mycloud/public/templates

HERE=$(dirname $0)

get_prop() {
  local PROP_NAME
  local VALUE
  local DEFAULT
  PROP_NAME="$1"
  DEFAULT="${2-}"

  VALUE=$(cat $HERE/../../vars.json | jq -r ".$PROP_NAME")
  if [[ ! $VALUE ]]
  then
    VALUE=$(cat $HERE/../../default-vars.json | jq -r ".$PROP_NAME")
  fi

  if [[ ! $VALUE ]]
  then
    if [[ ! $DEFAULT ]]
    then
      echo "unable to get property $PROP_NAME"
      exit 1
    fi

    VALUE="$DEFAULT"
  fi

  printf "$VALUE"
}

export AWS_PROFILE=$(get_prop "profile" "default")
export S3_TEMPLATES_PATH=$(get_prop "S3TemplatesBaseUrl")
