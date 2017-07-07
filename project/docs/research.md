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

### Demo

- capture logo [DONE]
- get testnet bitcoin

### Is Lambda better?

### Security

KMS for keys

### Testing

Load testing - e.g. 100 clients, 100 messages / second
https://artillery.io/docs/gettingstarted.html

### Bots
- in-house bot functionality
  - employees
  - REST/GraphQL API
    - TypeTable / index
    - index by type
- improve development experience for bots
  - maybe: in-memory bot with same API as in-cloud
- improve design for bot hooks (in other words, design it)

### Config (the journey to 1-click launch)
- holy grail
  - they go to tradle.io
  - they talk to Tradle bot
  - they put in their config:
    - region
    - vpc
    - etc.
  - they get a private link to launch their infrastructure (to a generated bootstrap.sh)
- map generated API gateway to custom domain
  - https://stackoverflow.com/questions/39507004/how-to-add-a-custom-domain-for-a-serverless-1-0-0-framework-defined-deployed-api
- auto-setup ssl certificates
  - http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-certificatemanager-certificate.html#w2ab2c19c12d100c17
- 1-click launch will probably be a script, e.g.: `curl https://github.com/tradle/serverless/bootstrap.sh | bash`, where bootstrap.sh will:
  - check that you have AWS keys configured
  - run serverless deploy
  - post-process to get API endpoints
  - ask the user what CNAMEs they want, and create those mappings
- use VPC

### Web App (bundled, served from s3 bucket)

### Stability

- aws-client edge cases, fallbacks

### Optimization

DynamoDB Auto Scaling
  http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/AutoScaling.HowTo.SDK.html

DynamoDB
  - reads: 
    - see Select here: http://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html
  select minimal attributes to make Read queries cheaper
  - writes:
    - make dynamodb updates more efficient, e.g. updates that modify a nested property (like bot-keep-fresh does)
    - use dynogels' algorithm for generating an UpdateExpression or https://github.com/4ossiblellc/dynamodb-update-expression

### Misc Features
- push notifications
  - http://docs.aws.amazon.com/sns/latest/dg/SNSMobilePush.html
  - https://www.npmjs.com/package/web-push
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

  client will reorder based on seq


  test whether disconnect/reconnect lose messages

how to prevent race condition on writes while ensuring increasing timestamp
?
  - by only accepting one message at a time

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

### Parameters for customer deployment

- capacity (scaled per table), e.g. 1 million txs / day
- region

### Resources

#### VPC 
sample with serverless:
  https://serverless.zone/aws-lambda-in-a-vpc-with-the-serverless-framework-7c3b92c151ad
  https://github.com/serverless-examples/serverless-infrastructure/issues/2

https://stackoverflow.com/a/27326400/1126660
  specify existing vpc during Launch Stack

#### Per-customer custom Launch Stack button

build --noDeploy in Lambda with parameters in serverless.yml?

dynamically generating a cloud formation template per customer with a cross-account role:
  https://aws.amazon.com/blogs/apn/generating-custom-aws-cloudformation-templates-with-lambda-to-create-cross-account-roles/
  https://aws.amazon.com/blogs/security/how-to-use-external-id-when-granting-access-to-your-aws-resources/

get response from aws (e.g. ARN for role) when customer deploys stack:
  https://aws.amazon.com/blogs/apn/collecting-information-from-aws-cloudformation-resources-created-in-external-accounts-with-custom-resources/

  https://aws.amazon.com/blogs/apn/wrap-up-cross-account-role-onboarding-workflow/
  Custom resources provide an additional benefit. They are triggered whenever the CloudFormation stack is updated or deleted.  If the customer modifies the template or deletes the stack, a notification will be sent to the APN Partner, which allows them to react to the change appropriately.  For example, if a user deletes the stack, the partner can reach out and ask if there were any technical problems that led to them discontinuing the service, provide an exit survey, or trigger an off-boarding workflow.

allow another AWS account to publish to your SNS topic
  http://docs.aws.amazon.com/sns/latest/dg/AccessPolicyLanguage_UseCases_Sns.html#AccessPolicyLanguage_UseCase1_Sns

  ```json
    {   
      "Version":"2012-10-17",
      "Id":"SomePolicyId",
      "Statement" :[
          {
              "Sid":"Statement1",
              "Effect":"Allow",           
              "Principal" :{
                  "AWS":"111122223333"
                },
              "Action":["sns:Subscribe"],
              "Resource": "arn:aws:sns:us-east-1:444455556666:MyTopic",
              "Condition" :{
                  "StringEquals" :{
                      "sns:Protocol":"https"
                   }
              }   
          }
      ]
    }
  ```

https://github.com/stelligent/dromedary-serverless

get resource ids from stack via lambda
  https://stelligent.com/2016/02/16/aws-lambda-backed-custom-resources-for-stack-outputs-resources-and-parameters/

custom calculations based on template parameters
  https://stackoverflow.com/questions/34693526/mathematical-operations-in-cloudformation

signed one-time-url for template resources (lambda zips)

### Monitoring Usage
  - monitor metrics logs
    - downsize: can't specify which resources to monitor, only account-wide
  - subscribe to their IoT $aws/events/subscriptions topic to measure how many customers they're talking with
  - "phone home" - log to particular topics, monitor those topics
  - tradle lambda in customer infrastructure that collects cloud metrics, e.g.: https://gist.github.com/fbrnc/5739f8bec042ac3326ad

  - cross account cloudwatch event delivery: https://aws.amazon.com/blogs/aws/new-cross-account-delivery-of-cloudwatch-events/

  - cloud watch alerts -> sns notifications -> email http://marcelog.github.io/articles/aws_cloudwatch_monitor_lambda_alerts.html
### Concerns

sending a SelfIntroduction with an identity with N keys will cause N lookups in the PubKeysTable - potential attack against that table's read capacity

maybe duplicate `pub` to another attribute and use IN ComparisonOperator (unusable in KeyConditionExpression)
