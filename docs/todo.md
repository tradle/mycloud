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
              _author + time
              _recipient + time

        B:
          primary key:
            _author + time
          secondary indexes:
            _recipient + time
            _link
  maybe create two identical fake models to map to Inbox, Outbox? e.g. InboundMessage, OutboundMessage.
    - then @tradle/dynamodb would need to support alternate primary keys (currently it's _link for everything)

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
