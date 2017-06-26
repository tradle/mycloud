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

separate logs with private data from logs that can be shared with Tradle

Lambda infrastructure is internal to the company
inter-Lambda infrastructures talk to each other via webhooks/REST
clients to Lambda talk via MQTT, to take advantage of the persistent connection
internal bots talk via MQTT
external bots via webhooks/REST

initial MQTT auth challenge-response needs to be upgraded to mutual auth: client firsts downloads identity of the server, and the server should sign the challenge

how to auth internal/external bot, when they're pinged by a webhook?

maybe:
  webhooker lambda long-polls bot, bot responds with request for messages on the same connection, lambda delivers on the same connection

Latency:
  auth maybe should go over MQTT

rely on MQTT to deliver (don't ask client to give you lost messages)

bot can run:
  in a wrapped lambda
  in a naked lambda

bot can read from InboxTable

MQTT -> write to Inbox

how important is ordering for identity
  very important
  re-ordering needs to be done before business logic is called

InboxTable can have a flag: validated
  if it's in order, validate it, otherwise validate it after ordering

call the bot lambda directly, don't use MQTT, or webhooks

bot should be receiving event, and processing, not thinking about order 

if we directly invoke lambda, we lose order guarantees (like the ones we have with sharding), because if the bot is busy processing message 1 from user U, and message 2 comes in, it will launch another Lambda instance to process 2, ignoring 



synchronizing clocks
during auth, synchronize clocks (per provider)
on reconnect, always broadcast position (last sent/received), and wait for green light
messages queued offline are rejected if there are undelivered messages for you

after green light, give Re-send option for any previously queued messages

add timestamp to messages

client delivers one message at a time, receives per-message acks (prevents needing to re-order)

client connects:
  sends the identifier of the last message it sent and the last message it received


client waits for green light from server
ordering is by timestamp

per-message acks

postpone implementation of:
  lambda lock per client
  re-ordering (ack instead)

## TODO
  - map generated API gateway to custom domain
    - https://stackoverflow.com/questions/39507004/how-to-add-a-custom-domain-for-a-serverless-1-0-0-framework-defined-deployed-api
  - auto-setup ssl certificates
    - http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-certificatemanager-certificate.html#w2ab2c19c12d100c17
  - 1-click launch
    - e.g.: curl https://github.com/tradle/serverless/bootstrap.sh | bash
    - bootstrap.sh will (via a wizard):
      - check that you have AWS keys configured
      - run serverless deploy
      - post-process to get API endpoints
      - ask the user what CNAMEs they want, and create those mappings
  - development environment for bots
  - improve design for bot hooks (in other words, design it)

  - push notifications
    - http://docs.aws.amazon.com/sns/latest/dg/SNSMobilePush.html
    - https://www.npmjs.com/package/web-push
  - TypeTable
    - index by type
  - where should we be using ElastiCache instead of DynamoDB? For example - PresenceTable might be better placed in ElastiCache, since data there is small-sized and short lived. However, ElastiCache is for ephemeral data..

  - handle blockHeight
  - support multiple networks
  - table per network?
  - layer that abstracts away DynamoDB

  - test whether clients get messages they subscribed to if they go offline and back online
    - they don't

  - encrypt stuff
    - https://github.com/serverless/examples/tree/master/aws-node-env-variables-encrypted-in-a-file

  - compatibility layer so existing bots (e.g. silly) can work out of the box
  - use VPC

## Optimization
  - find optimal memorySize for each function (maybe dynamically)
  - locate the bottlenecks (AWS X-Ray)
    - time all methods

requires long-lived clientIds

support WillNotDeliver error in @tradle/engine sender

need "dontsend" sendstatus

HTTP POST messages that are > 128KB
if the server needs to send a message > 128KB, it can create a file in an S3 bucket, and give the client permission to download it. cron-Lambda can prune this bucket every 5 minutes

check that inbound messages has increasing timestamp (compared with previous)

on disconnect - mark them as disconnected
authentication expires
is reauth on every connect needed?

when MQTT authentication expires, or authentication fails, the client should be able to detect that and reconnect/reauth

Discussion (sequence numbers vs link-to-previous-message):
  use sequence numbers for now (when creating messages on the server)
  
  add link to previous message

  getLastSeq race condition:
    retry update() if it fails because another write took that seq

  client will reorder based on seq


  test whether disconnect/reconnect lose messages

how to prevent race condition on writes while ensuring increasing timestamp
?
  - by only accepting one message at a time

## Performance

make dynamodb updates more efficient, e.g. updates that modify a nested property (like bot-keep-fresh does)

## Blockchain

### Notes

don't need cb-proxy because it's only one provider

### Questions
- do we need Kinesis as a buffer between IoT broke and Lambda?
  - if there are max 1K Lambdas running at once, and 1M users come for a chat...
- should there be a table per blockchain? or should all seals be in the same table
- where will the full node run?

in which tables and which cases can we tolerate eventually consistent reads? In which tables and which cases do we need strongly consistent reads?

will we be implementing DynamoDB Transactions for Node.js?
  aws-sdk-js issue: https://github.com/aws/aws-sdk-js/issues/1004
  initial js implementation: https://github.com/aaaristo/dyngodb/issues/19

should we use streams for reporting detected seals?

Optimization
  - put to s3 is too slow
  - maybe put somewhere else fast, and then put in s3

### Gotchas

if deploying from scratch, X-Ray requires permissions to be deployed before tracing can be turned on, so first deploy with awsTracingConfig commented out

also, after first deploy, need to re-run gen:env script to get iot-endpoint
