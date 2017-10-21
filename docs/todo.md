TODO:
  sign identity with all its keys
  maybe store signature separately from identity?

  sign identity every time it's sent or only on creation/update

  put Elasticache (Redis) in front of Objects bucket

  tighten policies on access to buckets/tables

fix putEvent to use conditional update 

DynamoDB:
  queries should keep removed properties in mind
  collapse Inbox/Outbox? (probably not)
    queries needed:
      getMessagesFrom (> timestamp || > seq || > given message)
      getLastMessageFrom
      getMessagesTo (> timestamp || > seq || > given message)
      getLastMessageTo
      getMessageByLink
      getConversation - maybe not needed (> timestamp)

      options:
        A:
          primary key:
            _link
            secondary indexes:
              _author, time
              _recipient, time

        B:
          primary key:
            _author, time
          secondary indexes:
            concat(_inbound + _recipient), time
            _link
        C:
          primary key:
            concat(_author, _recipient, time)


  maybe create two identical fake models to map to Inbox, Outbox? e.g. InboundMessage, OutboundMessage.

  use @tradle/dynamodb or at least dynogels wrappers for Messages and Identities
    - but how to avoid creating expensive indexes for _author + _time, _recipient + _time, etc?

Lambda:
  optimal memory/cpu size tuning: https://serverless.com/blog/aws-lambda-power-tuning/
  use one lambda for all http endpoints?
    https://github.com/dougmoscrop/serverless-http/blob/master/docs/EXAMPLES.md
    pros
      less lambdas to warm
    cons
      memory/cpu can't be fine tuned

  keep lambdas warm:
    https://github.com/FidelLimited/serverless-plugin-warmup
  logging:
    https://github.com/dougmoscrop/serverless-plugin-log-subscription#configuration
    http://theburningmonk.com/2017/09/tips-and-tricks-for-logging-and-monitoring-aws-lambda-functions/
  slim code zip
    https://github.com/dougmoscrop/serverless-plugin-include-dependencies
    https://github.com/dougmoscrop/serverless-plugin-common-excludes
  cost calculation:
    https://github.com/concurrencylabs/aws-pricing-tools

don't waste lambda invocations on s3 resources (e.g. /info should really go straight to s3)

IoT:
  get the subscribe/receive topic restrictions working (per ${iot:ClientId})
  make 2nd auth step (/auth) available via MQTT

S3:
  limit max object size in FileUploadBucket

Misc:
  scrap superagent, use node-fetch

ES7 Async/Await:
  https://github.com/AnomalyInnovations/serverless-es7

Function optimization:
  can we package continuously in the background?
  https://github.com/serverless-heaven/serverless-webpack

Environment variables alternative:
  http://theburningmonk.com/2017/09/you-should-use-ssm-parameter-store-over-lambda-env-variables/

GraphQL
  protocol buffers? With a strongly typed system, and the verbosity of json, could be a great payload diet

don't save double-wrapped messages in {prefix}tradle_Message

Lambda Tests:
  ensure events incoming to lambdas map to correct library function calls

fix /inbox, rm /message route

Bot / Bot Engine / Tradle Engine co-location
  - how will people develop bots? Will they clone tradle/serverless, and develop inside the cloned repo? Currently samplebot/ is in this repo, but it can sit outside just fine. Need some conf file for the engine to know where to find the bot code and initialize it, e.g. in conf/tradle.json, the dev can add: "bot": "my-bot-module", and the predeploy script can install it
    - maybe there should be two stacks
    - 1. you deploy the tradle stack
    - 2. you deploy the bot stack, and somehow give the tradle stack the bot stack's coordinates...and models, and everything else
  - how does Tradle Engine know where to find the bot code?

scrap service discovery
  it's now only used to set the IOT_ENDPOINT env var on all lambdas, so it's prob not really needed. Lambdas that need the IOT_ENDPOINT, can get it themselves via aws.iot.describeEndpoint

get rid of compile-template step
