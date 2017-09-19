TODO:
  sign identity with all its keys
  maybe store signature separately from identity?

  sign identity every time it's sent or only on creation/update

  put Elasticache (Redis) in front of Objects bucket

  tighten policies on access to buckets/tables
  
onClientConnect:
  1. handshake
  2. send next unsent message

validate identity in preprocess

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
  use aws-serverless-express for all http endpoints
  don't waste a lambda invocation on OPTIONS requests. Learn from aws-serverless-express/example, with OPTIONS contentHandling set to CONVERT_TO_TEXT
  optimal memory/cpu size tuning: https://serverless.com/blog/aws-lambda-power-tuning/

don't waste lambda invocations on s3 resources (e.g. /info should really go straight to s3)

IoT:
  get the subscribe/receive topic restrictions working (per ${iot:ClientId})
  make 2nd auth step (/auth) available via MQTT

S3:
  limit max object size in FileUploadBucket

Misc:
  scrap superagent, use node-fetch

Init:
  recharge, seal own identity

Ethereum:
  transactions may not be mined at all. After being successfully submitted to etherscan, if they're non-existent on the next sync, they need to be unqueued for syncUnconfirmed and re-queued for sealPending

Cloud-cloud delivery
  HTTP (not MQTT). No sessions, just sign every message, with recent ethereum block hashes serving as nonces (to prove signature recency)

  potential algorithm:
    send message:
      1. POST to their outbox - get messages queued up for me since the last message received
      2. POST to their inbox - send messages
      response may contain messages sent in response, but maybe not worth waiting, as lambdas are billed on time.

  or should we be augmenting the graphql api with mutations?

Security
  graphql api needs authentication, e.g. requests can be signed with employee credentials

