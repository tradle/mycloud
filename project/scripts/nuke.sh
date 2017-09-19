#!/bin/sh

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
            Y*|y*) return 0 ;;
            N*|n*) return 1 ;;
        esac

    done
}

remove_buckets() {
    # do dangerous stuff
  # set -o xtrace
  # todo: respect actual service name and stage!
  aws s3 ls | awk '{print $3;}' | grep tradle-dev | grep -v tradle-dev-serverless | while read line; do
    ask "delete bucket ${line}?" && aws s3 rb "s3://$line" --force
  done
}

echo "This will empty and delete all buckets, tables, lambdas, etc."
ask && remove_buckets
ask "delete resources stack" && sls remove
ask "delete per-type tables" && node ./scripts/delete-tables.js
