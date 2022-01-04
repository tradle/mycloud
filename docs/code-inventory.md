# Server
## Messaging stack 
## Lambdas 
### Start stack lambda 
### Init lambda 
### Warm up lambda 
## Plugins 
### House bot
### Plugins in various Lambdas
### Security on creation or edit of resources
### Security on reading resources
### How to write a plugin 
## GraphQL
Standard GraphQL is supported for queries. GraphQL Mutations are not supported. Instead we are using a reliable messaging mechanism for sending data from mobile and web clients to the server. 
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

### Athenafeed 
Backup S3 object to the data lake. See doc at: https://github.com/tradle/mycloud/blob/master/docs/backup-to-datalake.md

## UI for Configuation
## Translation utility
## Tradleconf - Command line interface (CLI) 
## Cloudformation 
## Tests
### Running tests on git commit
## Blockchain adapters
### Blockchain binding algo

# Client
## Third party integarions
### Regula
### Branch

# Third-party services
## AWS
## NPM
