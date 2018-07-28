TODO:
  sign identity with all its keys
  maybe store signature separately from identity?

  sign identity every time it's sent or only on creation/update

  put Elasticache (Redis) in front of Objects bucket

  tighten policies on access to buckets/tables

fix putEvent to use conditional update 

Lambda:
  optimal memory/cpu size tuning: https://serverless.com/blog/aws-lambda-power-tuning/
  use one lambda for all http endpoints?
    https://github.com/dougmoscrop/serverless-http/blob/master/docs/EXAMPLES.md
    pros
      less lambdas to warm
    cons
      memory/cpu can't be fine tuned per route

don't waste lambda invocations on s3 resources (e.g. /info should really go straight to s3)

IoT:
  make 2nd auth step (/auth) available via MQTT

S3:
  limit max object size in FileUploadBucket

Misc:
  scrap superagent, use node-fetch

Function optimization:
  can we package continuously in the background?
  https://github.com/serverless-heaven/serverless-webpack

GraphQL
  protocol buffers? With a strongly typed system, and the verbosity of json, could be a great payload diet

Lambda -> API integration tests:
  ensure events incoming to lambdas map to correct library function calls

Bot / Bot Engine / Tradle Engine co-location
  - how will people develop bots? Will they clone tradle/serverless, and develop inside the cloned repo? Currently in-house-bot/ is in this repo, but it can sit outside just fine. Need some conf file for the engine to know where to find the bot code and initialize it, e.g. in conf/tradle.json, the dev can add: "bot": "my-bot-module", and the predeploy script can install it
    - maybe there should be two stacks
    - 1. you deploy the tradle stack
    - 2. you deploy the bot stack, and somehow give the tradle stack the bot stack's coordinates...and models, and everything else
  - how does Tradle Engine know where to find the bot code?

get rid of compile-template step
