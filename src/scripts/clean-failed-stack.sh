#!/bin/bash

set -x

STACK_NAME=$1
AWS_REGION=${AWS_REGION-us-east-1}

if [[ ! $STACK_NAME ]]
then
  echo "expected stack name as first argument"
  exit 1
fi

awsr() {
  aws --region $AWS_REGION $@
}

# STATUS=$(awsr cloudformation describe-stack --stack-name tdl-mv-ltd-dev | jq -r '.Stacks[0].StackStatus')

awsr cloudformation delete-stack --stack-name "$STACK_NAME" || echo 'stack is probably already deleted'

TABLES=$(awsr dynamodb list-tables | jq -r .TableNames[] | grep $STACK_NAME)
for t in $TABLES;
do
  echo deleting $t
  awsr dynamodb delete-table --table-name "$t"
done

BUCKETS=$(awsr s3 ls | grep $STACK_NAME | awk '{ print $3 }')
for b in $BUCKETS; 
do 
  echo deleting $b
  delete-aws-bucket "$b"
done

LOG_GROUPS=$(awsr logs describe-log-groups | jq -r '.logGroups[].logGroupName' | grep "/aws/lambda/$STACK_NAME")
for l in $LOG_GROUPS;
do
  echo deleting $l
  awsr logs delete-log-group --log-group-name "$l"
done

set +x
