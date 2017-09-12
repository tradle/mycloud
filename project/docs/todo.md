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
  collapse Inbox/Outbox?
  use @tradle/dynamodb or at least dynogels wrappers for Messages and Identities
    - but how to avoid creating expensive indexes for _author + _time, _recipient + _time, etc?

Lambda:
  use aws-serverless-express for all http endpoints
  don't waste a lambda invocation on OPTIONS requests. Learn from aws-serverless-express/example, with OPTIONS contentHandling set to CONVERT_TO_TEXT

don't waste lambda invocations on s3 resources (e.g. /info should really go straight to s3)

IoT:
  get the subscribe/receive topic restrictions working (per ${iot:ClientId})
  make 2nd auth step (/auth) available via MQTT

S3:
  limit max object size in FileUploadBucket
