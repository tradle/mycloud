#!/bin/bash
#
# This scripts allows to specify arguments for a command and it's subcommand. For example: Let's
# say we have the main command `node` and a script `./index.js` it would look like
# 
#    node ./index.js
#
# Let's say we want to pass-in an argument to `./index.js`
#
#    node ./index.js foo
#
# And this is part of our npm scripts section in the `package.json`:
#
#    {
#      ...
#      "scripts": {
#        "start": "node ./index.js"
#      }
#      ...
#    }
#
# By running `npm start -- foo` we can pass `foo` through to the `./index.js` script. However,
# arguments can be passed-in both to `node` and `./index.js` like this:
#
#    node --inspect ./index.js foo
#
# Here `--inspect` will be passed to `node` and `foo` will be passed to `./index.js`. We can
# do that using this script by changing the `./package.json` to.
#
#    {
#      ...
#      "scripts": {
#        "start": "split-args.sh node -- ./index.js --"
#      }
#      ...
#    }
#
# Now we can pass in arguments both to `node` and `./index.js` using separators:
#
#    npm start -- --inspect -- foo
#
# Everything before the second "--" will be passed to `node` and everything after that will
# be passed to `./index.js`.
#
CMD_1=
CMD_2=
ARGS_1=
ARGS_2=
PART=0

# Util to append a string to another with a space but allows the first string to be empty
# Example usage:
#
#    foo=
#    foo=$(append $foo "bar") # foo="bar"
#    foo=$(append $foo "baz") # foo="bar baz"
#
function append () {
  result=""
  for part in $@; do
    if [[ part != "" ]]; then
      if [[ result != "" ]]; then
        result="$result $part"
      else
        result="$part"
      fi
    fi
  done
  echo $result
}

for arg in $@; do
  if [[ $PART == 0 ]]; then
    if [[ $arg == "--" ]]; then
      PART=1
    else
      CMD_1=$(append $CMD_1 "$arg")
    fi
  elif [[ $PART == 1 ]]; then
    if [[ $arg == "--" ]]; then
      PART=2
    else
      CMD_2=$(append $CMD_2 "$arg")
    fi
  elif [[ $PART == 2 ]]; then
    if [[ $arg == "--" ]]; then
      PART=3
    else
      ARGS_1=$(append $ARGS_1 "$arg")
    fi
  else
    ARGS_2=$(append $ARGS_2 "$arg")
  fi
done

CMD="$CMD_1 $ARGS_1 $CMD_2 $ARGS_2"
echo "> $CMD"
$CMD
