# Server
Documented at https://github.com/tradle/mycloud

## Messaging stack 
Tradle implements asynchronous messagging with the highest level of guaranteed delivery for messages sent from client to server and from server to client. It implements resends if connection was dropped, it automatically resends when connection is back, it removes duplicate messages, and it never loses a message.

For reliable delivery inbound and outbound messages are stored in the append-only log on the client side. Similarly the append-only log is kept on the server (MyCloud) and DynamoDB tables inbox and outbox are used for persistence.

For network we use MQTT on top of WebSockets (WebSockets is a mature and stable protocol on top of HTTP that is universally by Web proxies and API gateways. MQTT is a mature and stable publish / subscribe protocol that is extremely lightweight as it was designed to support high throughput of messages from low powered IoT devices (in AWS MQTT service is called AWS IoT). (xxx - what MQTT queue names do we use?)

WebSockets gives us bidirectional communication line between the client and the server, that is either one can initiate a message. When network connectivity is lost client's messaging stack automatically reconnects, restoring WebSockets and MQTT and initiating resync with the other side (How is it done by the server xxx). To start a connection AWS STS service is used, as it is required by the security implementation for MQTT.

## Lambdas 
### Start and update stack lambda 

### Init lambda 
### Warm up lambda 
## Plugins 
### House bot
### Plugins in various Lambdas
### Security on creation or edit of resources
### Security on reading resources
### How to write a plugin 
## GraphQL
Standard [GraphQL](https://graphql.org/code/) is supported for queries. GraphQL Mutations are not supported. Instead we are using our own reliable messaging mechanism for sending data from mobile and web clients to the server. 
You can use an open source Graphiql tool to view all resources in MyCloud. 
(to enabled this, put graphqlAuth: false in bot.json. WARNING - this is only for development, production  servers MUST have graphqlAuth: true)
### mapping to GraphQL schema
GraphQL schema language is super verbose. We use JSON Schema language for our data models. 
This code maps automatically to GraphQL schema. 
### GraphQL resolvers
those are plugins to the GraphQL queries
## Data models
## DB api 
## Engine API
## Scheduled jobs
Scheduled jobs use the DynamoDB TTL as a time tick. 
For the fill updated list of jobs, go here:
https://github.com/tradle/mycloud/tree/master/src/in-house-bot/jobs

1. athenafeed.ts             - incremental backup of all operational data as individual S3 object to the data lake for reporting with any BI tool. See doc at: https://github.com/tradle/mycloud/blob/master/docs/backup-to-datalake.md
1. chaser.ts                 - customer onboarding outreach via email, chases customers that did not respond in time (uses configurable policy - xxx).
1. contractChaser.ts         - invoicing for leasing: sends Tradle app msg reminding customer to make a payment
1. importBasicCompanyData.ts - imports companieshouse.gov.uk into the data lake
1. importCzech.ts            - download data from Czech ministry of justice site 
1. importLei.ts              - LEI data download
1. importMaxmindDb.ts        - import the data for the IP to address mapping
1. importPitchbook.ts        - import company and its investors data from Pitchbook commercial provider
1. importPsc.ts              - import UK UBO data (persons of significant control)
1. importRefdata.ts          - import registered regulated companies from BaFIN (DE), FCA (UK), FINRA/SEC (US)
1. pendingChecksChaser.ts    - delayed Athena query execution (universal - can be used by any plugin that uses Athena)
1. pendingWorksHandler.ts    - universal delayed API request execution (universal - can be used by any plugin at uses 3rd party APIs)
1. roarFeedback.ts           - integration with Oracle Financials Risk Engine


## UI for Configuation
## Translation utility
## Tradleconf - Command line interface (CLI) 
Fully documented at https://github.com/tradle/tradleconf

## Cloudformation 
We are using Serverless-framework that compiles template files into the AWS Cloudformation template.
AWS CloudFormation template is normally instantiated from the AWS Console. Tradle app, after user applies for product MyCloud, generates a link to the AWS Conlodformation page in AWS Console, end at the bottom of that page there is a button to click that will launch MyCloud from that template.

Main Serverless template is here: https://github.com/tradle/mycloud/blob/master/serverless-uncompiled.yml
Subordinate templates, that are referenced by the main temlpate are here: https://github.com/tradle/mycloud/tree/master/cloudformation
Multiple temlpates are used due to the limitation of maximum of 200 resources per template.

## Tests
### Running tests on git commit
## Blockchain adapters
### Blockchain binding algo

# Client
Documented at https://github.com/tradle/tim

## Third party integarions
### Regula
### Branch

# Dependency on third-party services
## AWS
## NPM
## Etherscan
## Google push notifications service
## Apple push notifications service
## Analytics for mobile app
