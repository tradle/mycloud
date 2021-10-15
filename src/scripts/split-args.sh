#!/bin/bash
CMD_1=
CMD_2=
ARGS_1=
ARGS_2=
PART=0
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
