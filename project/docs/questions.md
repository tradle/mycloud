## Cool tools

visualize the architecture: https://cloudcraft.co/app

https://github.com/lambci/docker-lambda
  - rebuild native node modules for AWS Lambda environment

LambCI - lambda-based CI, costs nothing when it's not building your crap

## Questions

encrypt objects in s3?

what is the encrypt/decrypt identity keys flow?

how to handle different regions/availability zones for dynamodb / lambda?

how to handle Lambda failures
http://docs.aws.amazon.com/lambda/latest/dg/retries-on-errors.html

if we use event log
  - how do we ensure sequential processing of messages (by msg.seq rather than timestamp)

push on new messages, pull on delivered-at-least-once


  Inbox / Outbox - two tables?
  Message (outbox) table triggers = push delivery

do we need a separate Table for objects so we can look up latest versions of objects by permalink?


when adding a new contact - if the message is sent by the identity owner, two pub keys can be mapped to the identity - the signing key for the identity (update key), and the signing key for the message ()


need to rethink what happens when people announce other people's pubKeys as their own

when adding a mapping to the db, need to be sure the pub key being mapped to the identity is a pub key the identity controls

Sessions
  need to authenticate before sending the client anything

log security events - invalid signatures, etc.

Assumptions:
  messages arrive in order, per sender

Efficiency questions:
  inbound msg => event log => fan out => view table => processor
  maybe some of these can be in parallel, e.g.
  inbound msg => event log => message view table
              => fan out => processor


how message delivery works?
  - aws iot doesn't support persistent sessions or retained messages


gotchas:
  native node modules need re-compiling
  dynamodb conditional write
    update({ Key, Item }) silently throws out Item. Have to use UpdateExpression, ExpressionAttritbuteNames..
  environment variables (for resources, and others)

seal pipeline:
  business logic event -> Lambda.seal -> log

receive pipeline:
  incoming mqtt message -> Lambda.onreceive -> log to Table.Events ---db-stream--> Lambda.fanout -> Lambda.receive -> write to Table.Messages ---db-stream--> business logic processing (bot)

send pipeline:
  business logic event -> Lambda.queueSend -> log to EventsTable ---db-stream--> Lambda.fanout -> Lambda.deliver

MQTT message with multiple messages

when a client disconnects

deleting expired sessions. Use DynamoDB TTL? or a scheduled lambda

when does a client need to reauth? How do they know their session expired


cross-AWS-account IAM role for Tradle to monitor the Cloudwatch Logs
