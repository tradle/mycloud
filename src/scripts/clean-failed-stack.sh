#!/bin/bash

STACK_NAME=$1

if [[ ! $STACK_NAME ]]
then
  echo "expected stack name as first argument"
  exit 1
fi

# STATUS=$(aws cloudformation describe-stack --stack-name tdl-mv-ltd-dev | jq -r '.Stacks[0].StackStatus')

aws cloudformation delete-stack --stack-name "$STACK_NAME" || echo 'stack is probably already deleted'

TABLES=$(aws dynamodb list-tables | jq -r .TableNames[] | grep $STACK_NAME)
for t in $TABLES;
do
  echo deleting $t
  aws dynamodb delete-table --table-name "$t"
done

BUCKETS=$(aws s3 ls | grep $STACK_NAME | awk '{ print $3 }')
for b in $BUCKETS; 
do 
  echo deleting $b
  delete-aws-bucket "$b"
done

LOG_GROUPS=$(aws logs describe-log-groups | jq -r '.logGroups[].logGroupName' | grep "/aws/lambda/$STACK_NAME")
for l in $LOG_GROUPS;
do
  echo deleting $l
  aws logs delete-log-group --log-group-name "$l"
done