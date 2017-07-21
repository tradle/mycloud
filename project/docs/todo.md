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

Lambda:
  enable compression of response (gzip for graphql):
    https://github.com/awslabs/aws-serverless-express/pull/51
