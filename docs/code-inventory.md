# Server
Documented at https://github.com/tradle/mycloud

## Messaging stack 
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

athenafeed.ts             - incremental backup of all operational data as individual S3 object to the data lake for reporting with any BI tool. See doc at: https://github.com/tradle/mycloud/blob/master/docs/backup-to-datalake.md
chaser.ts                 - customer onboarding outreach via email, chases customers that did not respond in time (uses configurable policy - xxx).
contractChaser.ts         - invoicing for leasing: sends Tradle app msg reminding customer to make a payment
importBasicCompanyData.ts - imports companieshouse.gov.uk into the data lake
importCzech.ts            - download data from Czech ministry of justice site 
importLei.ts              - LEI data download
importMaxmindDb.ts        - import the data for the IP to address mapping
importPitchbook.ts        - import company and its investors data from Pitchbook commercial provider
importPsc.ts              - import UK UBO data (persons of significant control)
importRefdata.ts          - import registered regulated companies from BaFIN (DE), FCA (UK), FINRA/SEC (US)
pendingChecksChaser.ts    - delayed Athena query execution (universal - can be used by any plugin that uses Athena)
pendingWorksHandler.ts    - universal delayed API request execution (universal - can be used by any plugin at uses 3rd party APIs)
roarFeedback.ts           - integration with Oracle Financials Risk Engine


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
