
# tradle/aws

## Setup

1. Set up AWS credentials in ~/.aws/
2. Install 

```sh
npm run setup
```

The [Serverless Framework](https://github.com/serverless/serverless) is installed as part of `devDependencies`, but you probably also want it installed globally so you can use the serverless cli:

```sh
npm i -g serverless
```

### Run Tests

```sh
npm test
```

### Deploy

First, make sure Docker is running

```sh
# make sure docker is running
docker ps
# 1. lint & test
# 2. rebuild native modules with AWS Linux container
# 3. deploy to cloud
npm run deploy:safe
```

### Explore

#### List deployed resources, API endpoints, ...

```sh
npm run info

# Service Information
# service: tradle
# stage: dev
# ...
# endpoints:
#  ..
#  ANY - https://example.execute-api.us-east-1.amazonaws.com/dev/tradle/graphql
#  ANY - https://example.execute-api.us-east-1.amazonaws.com/dev/tradle/samples
#  ..
```

#### Generate sample data

If you want to play with the API, you'll first need some data. Let's generate sample data for a single user going through an application for a [Current Account](https://github.com/tradle/custom-models/blob/master/models/tradle.CurrentAccount.json).

```sh
# replace endpoint url with your own
curl -X POST --data '{"users":1,"products":["tradle.CurrentAccount"]}' \
'https://example.execute-api.us-east-1.amazonaws.com/dev/tradle/samples'
```

#### Explore the API

Open GraphiQL and play with API. Let's create a url with a sample query (because there's an unresolved issue for when no query is passed):

```js
const url = 'https://example.execute-api.us-east-1.amazonaws.com/dev/tradle/graphql?query=' + encodeURIComponent(`{
  rl_tradle_FormRequest {
    edges {
      node {
        _link
      }
    }
  }
}`)

console.log(url)
// https://example.execute-api.us-east-1.amazonaws.com/dev/tradle/graphql?query=%7B%0A%20%20rl_tradle_FormRequest%20%7B%0A%20%20%20%20edges%20%7B%0A%20%20%20%20%20%20node%20%7B%0A%20%20%20%20%20%20%20%20_link%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D
// open in browser
```

#### Logging

You can use the serverless cli:

```sh
sls logs -f bot_graphql --tail
```

Or, for convenience, there's a `tail`-ish script:

```sh
npm run tail -- {function-name} {minutes-ago}
# e.g log the graphql lambda starting 5 minutes ago:
npm run tail -- bot_graphql 5
```

### Destroy

Sometimes you want to wipe the slate clean and start from scratch (usually by age 25 or so). The following command will wipe out all the AWS resources created in your deployment. Obviously, use with EXTREME caution, as this command executes with your AWS credentials (best use a separate account).

```sh
npm run nuke
# a series of y/n prompts ensues, 
# ensuring you're committed to the destruction of all that is holy
```

## Directory Structure

```sh
.              # dev dependencies, serverless framework config
  /cli         # ignore me for now
  /scripts     # various helper scripts
  /project     # code that will be deployed to lambda
    /conf      # various table schemas, used for tests
    /lib
      /bot     # bot engine
    /samplebot # currently co-located sample bot in `./project/samplebot`
```
