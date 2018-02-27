#!/bin/bash

breakout () {
  printf "canceled"
}

trap breakout SIGINT

SERVICE=$1
STAGE=$2
PROFILE=$3

if [ -z "$SERVICE" ]; then
  echo "first arg must be the service name"
  exit 1
fi

if [ -z "$STAGE" ]; then
  echo "second arg must be the stage name"
  exit 1
fi

if [ -z "$PROFILE" ]; then
  PROFILE=$(./lib/scripts/var.js provider.profile)
  echo "using AWS profile $PROFILE"
fi

ask() {
    # https://djm.me/ask
    local prompt default REPLY

    while true; do

        if [ "${2:-}" = "Y" ]; then
            prompt="Y/n"
            default=Y
        elif [ "${2:-}" = "N" ]; then
            prompt="y/N"
            default=N
        else
            prompt="y/n"
            default=
        fi

        # Ask the question (not using "read -p" as it uses stderr not stdout)
        echo -n "$1 [$prompt] "

        # Read the answer (use /dev/tty in case stdin is redirected from somewhere else)
        read REPLY </dev/tty

        # Default?
        if [ -z "$REPLY" ]; then
            REPLY=$default
        fi

        # Check if the reply is valid
        case "$REPLY" in
            Y*|y*)
              return 0 ;;
            N*|n*)
              return 1 ;;
            *)
              echo "canceled"
              exit 1
        esac

    done
}

echo "This will empty and delete all buckets, tables, lambdas, etc. for"
echo "service: $SERVICE"
echo "stage: $STAGE"

ask "delete resources stack" && sls remove --stage="$STAGE"
ask && ./lib/scripts/delete-remote-buckets.js
