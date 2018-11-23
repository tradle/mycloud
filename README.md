# @tradle/serverless

Welcome to Tradle serverless / Tradle MyCloud! You'll find everything you need to configure and launch your own Tradle instance here.

If you're developer, you'll also see how to set up your local environment, deploy, and develop your own chatbots.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->


- [Orientation](#orientation)
  - [Digital Identity Intro](#digital-identity-intro)
- [Setup](#setup)
  - [Tools](#tools)
    - [Git](#git)
    - [Node.js](#nodejs)
    - [Docker & Docker Compose](#docker--docker-compose)
    - [AWS cli & credentials](#aws-cli--credentials)
    - [JQ](#jq)
    - [Typescript](#typescript)
  - [Development Tools](#development-tools)
  - [Clone this project](#clone-this-project)
  - [Install dependencies](#install-dependencies)
  - [Set AWS profile](#set-aws-profile)
- [Local Playground](#local-playground)
  - [Start docker](#start-docker)
  - [Start the Playground](#start-the-playground)
  - [Explore the API](#explore-the-api)
  - [AWS cli (local)](#aws-cli-local)
  - [Deployment](#deployment)
    - [Pre-deployment configuration](#pre-deployment-configuration)
    - [Deploy to AWS](#deploy-to-aws)
    - [Post-deployment configuration](#post-deployment-configuration)
  - [Explore the Architecture](#explore-the-architecture)
    - [List deployed resources, API endpoints, ...](#list-deployed-resources-api-endpoints-)
- [Development](#development)
  - [serverless.yml](#serverlessyml)
  - [Testing](#testing)
  - [Hot re-loading](#hot-re-loading)
  - [Logging](#logging)
- [Destroy](#destroy)
  - [[Deprecated] Destroy](#deprecated-destroy)
- [Troubleshooting local deployment](#troubleshooting-local-deployment)
- [Troubleshooting remote deployment](#troubleshooting-remote-deployment)
- [Scripts](#scripts)
  - [npm run localstack:start](#npm-run-localstackstart)
  - [npm run localstack:stop](#npm-run-localstackstop)
  - [npm run localstack:restart](#npm-run-localstackrestart)
  - [npm run localstack:update](#npm-run-localstackupdate)
  - [npm run gen:localstack](#npm-run-genlocalstack)
  - [npm run gen:localresources](#npm-run-genlocalresources)
  - [npm run nuke:local](#npm-run-nukelocal)
  - [npm run reset:local](#npm-run-resetlocal)
  - [npm run deploy:safe](#npm-run-deploysafe)
  - [npm run test:graphqlserver](#npm-run-testgraphqlserver)
  - [npm run graphqlserver](#npm-run-graphqlserver)
  - [warmup](#warmup)
- [Project Architecture](#project-architecture)
  - [Tools](#tools-1)
  - [Directory Structure](#directory-structure)
  - [Main Components](#main-components)
    - [Core Tables](#core-tables)
    - [Buckets](#buckets)
    - [Functions](#functions)
    - [Network communication flow](#network-communication-flow)
    - [Plugins](#plugins)
    - [Email templates](#email-templates)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Orientation

### Digital Identity Intro

Jump down the [rabbit hole](./docs/mythos.md)

## Setup

First, install some tools

### Tools

#### Git

Make sure you have `git` installed. If you're on `OS X`, you already have it.

#### Node.js

The following are the versions used by the Tradle dev team:

- Node.js@[8.10.0](https://nodejs.org/download/release/v8.10.0/) - this is the version used by Amazon for AWS Lambda. Yes, you can use the latest Node.js instead, but keep this in mind if you hit errors.
- npm@3.10.10 - npm@5 sometimes has trouble with big dependency trees

#### Docker & Docker Compose

Docker is used during the build process, as well as in the local playground. Docker Compose is used for container orchestration and networking

1. Docker  
  a. [OS X](https://docs.docker.com/docker-for-mac/install/)  
  b. [Window](https://docs.docker.com/docker-for-windows/install/)  
  c. [Linux](https://docs.docker.com/engine/installation/#server)  
2. [Docker Compose](https://docs.docker.com/compose/install/)

Make sure you can run docker as non-root. On Linux, you can do this by adding your user to the `docker` group with: `sudo gpasswd -a $USER docker`

#### AWS cli & credentials

1. [Install](http://docs.aws.amazon.com/cli/latest/userguide/installing.html)
1. create a new IAM user with AdministratorAccess
1. Configure your credentials: `aws configure` or `aws configure --profile <profileName>`. This will set up your AWS credentials in `~/.aws/`

#### JQ 

[jq](https://stedolan.github.io/jq/download/): a great command line JSON parser (On OS X, you can `brew install jq`)

#### Typescript

[typescript](typescriptlang.org): This project uses TypeScript, which needs to be compiled to JavaScript prior to use.

Install: `npm i -g --save-exact typescript@2.8.4`

*Note: Depending on your local setup you may need install with `sudo`*

### Development Tools

*Note: if you don't care about playing locally and want to skip ahead to deploying Tradle MyCloud to the cloud, skip this section*

- [awslocal](https://github.com/localstack/awscli-local). aws-cli wrapper for querying localstack. (On OS X, install with `[sudo] pip install awscli-local`)
- [Serverless Framework](https://github.com/serverless/serverless) - this is already installed as part of `devDependencies`, but you may also want it installed globally so you can use the serverless cli (`npm i -g serverless`)

### Clone this project

Clone this project. The rest of setup below takes place in the cloned repository's root folder.

### Install dependencies

```sh
# install dependencies
npm install
```

### Set AWS profile

By default, aws cli operations will run under the profile named `default`

If you ran `aws configure --profile <profileName>` and not `aws configure`, open `vars.json` and add a property:

```json
{
...
  "profile": "<profileName>"
...
}
```

## Local Playground

*Note: if you don't care about playing locally and want to skip ahead to deploying Tradle MyCloud to the cloud, skip this section*

Goal: set up an environment where we can talk to the chatbot that comes in the box, and see how we can develop our own.

### Set TMPDIR env var

Check if the environment variable TMPDIR is set, and if not set it (better add it to ~/.bash_profile or ~/.bashrc)

### Start docker

```sh
# make sure you have docker running
docker ps
```

### Start the Playground

The first time you start the playground, Docker will pull the necessary images from [Docker Hub](https://hub.docker.com), which can take a while, depending on which century your internet connection is from.

```sh
npm start
```

Now open your browser to [http://localhost:55555](http://localhost:55555). If 55555 is already your favorite port for something else, you can change the port in [./docker/docker-compose-localstack.yml](./docker/docker-compose-localstack.yml).

If you don't see your local provider, click the red menu button on the Conversations screen, choose "Add Server Url" and add `http://localhost:21012`

Profile                                    | Conversations                             | Chat
:-----------------------------------------:|:-----------------------------------------:|:-----------------------------------------:
![](./docs/images/profile-guided-w250.png) | ![](./docs/images/conversations-guided-w250.png) | ![](./docs/images/chat1-w250.png)

### Explore the API

After you chat with the bot a bit, open up GraphiQL at [http://localhost:21012](http://localhost:21012) and play with the API:

```sh
# http://localhost:21012
# 
# sample query:
{
  rl_tradle_ProductRequest {
    edges {
      node {
        _author,
        _time,
        _link,
        requestFor
      }
    }
  }
}
```

You can also browse the database via the DynamoDB Admin at [http://localhost:8001](http://localhost:8001)

When you deploy to the cloud, GraphiQL will be available at https://xxxxxxx.execute-api.us-east-1.amazonaws.com/dev/tradle/graphql

### AWS cli (local)

The endpoints for localstack are enumerated in their docs (or see [./src/test/localstack.json](./src/test/localstack.json)). To query them using the AWS cli, specify an additional `--endpoint` option, e.g.:

```sh
aws dynamodb list-tables --endpoint http://localhost:4569
aws s3 ls --endpoint http://localhost:4572
```

### Deployment

#### Pre-deployment configuration

- To change the region/name/domain/logo of your deployment, edit `./vars.json`. Then run `npm run build:yml`. See `./default-vars.json` for a list of variables you can override.
- If you'd like to write your own bot, for now the easier way to do it is directly in your cloned tradle/serverless repo. Check out the built-in bot in: [./in-house-bot/index.js](./in-house-bot/index.js).

#### Deploy to AWS

First, make sure Docker is running

```sh
# make sure docker is running
docker ps
```

**Autopilot**

```sh
# 1. compile typescript -> javascript
# 2. test
# 3. rebuild native modules with AWS Linux container
# 4. deploy to cloud
npm run deploy:safe
```

**Manual**

```sh
# compile typescript -> javascript
tsc
# gen resources in cloud emulator and test
npm run gen:localresources && npm test
# rebuild native modules with AWS Linux container
npm run rebuild:lambda
# deploy to cloud
npm run deploy
```

Deployment can take ~5-10 minutes.

Once everything's deployed, open your browser to [https://app.tradle.io](https://app.tradle.io). On the Conversations page, click the red button, and choose Add Server URL. Paste in your API endpoint (it looks like https://xxxxxxx.execute-api.us-east-1.amazonaws.com/dev/)

#### Post-deployment configuration

See [tradleconf](https://github.com/tradle/tradleconf), a command line tool for configuring styles, plugins, custom models, etc. of a deployed Tradle MyCloud.

### Explore the Architecture

#### List deployed resources, API endpoints, ...

```sh
npm run info # or run: sls info

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

## Development

This project uses TypeScript, which compiles to JavaScript. If you're changing any `*.ts` files, or if you run `git pull` be sure you have `tsc -w` running on the command line, which will watch for changes and rebuild your sources.

### serverless.yml

If you modify `serverless-uncompiled.yml`, run `npm run build:yml` to preprocess it. Before running tests, re-run `npm run gen:localresources`

To override variables in the yml without picking a fight with `git`, create a `vars.json` file in the project root. See [default-vars.json](./default-vars.json) for which variables you can override.

After modifying `vars.json`, run `npm run build:yml`

### Testing

Note: running tests messes with your locally emulated resources. After running tests, run `npm run reset:local` before running `npm start`

```sh
# run tests on local resources
npm run test
# browse that data via graphql
npm run test:graphqlserver
# GraphiQL is at       http://localhost:21012
# DynamoDB Admin is at http://localhost:8001
```

### Hot re-loading

Thanks to [serverless-offline](https://github.com/dherault/serverless-offline), changes made to the codebase will be hot-reloaded, which makes development that much sweeter...but also slower. To disable hot-reloading, add this in `vars.json`:

```yaml
serverless-offline:
  # disable hot-reloading
  skipCacheInvalidation: true
  # copy these from default-vars.json unless you want custom ones
  host: ...
  port: ...
```

### Logging

Use [tradleconf](https://github.com/tradle/tradleconf#logging)

## Destroy

Sometimes you want to wipe the slate clean and start from scratch (usually by age 25 or so). The following command will wipe out all the AWS resources created in your deployment. Obviously, use with EXTREME caution, as this command executes with your AWS credentials (best use a separate account).

To destroy your remote stack, resources, data, etc., use [tradleconf](https://github.com/tradle/tradleconf#destroy)

To destroy your local resources, use `npm run nuke:local`, or `npm run reset:local` to destroy + reinit

### [Deprecated] Destroy

```sh
npm run nuke
# a series of y/n prompts ensues, 
# ensuring you're committed to the destruction of all that is holy
```

## Troubleshooting local deployment

Note: this is ONLY for troubleshooting your local development environment and NOT your remote deployment

**Symptom**:

```sh
# Error: connect ECONNREFUSED 127.0.0.1:4569
# ...
```

**Cause**: `localstack` is not up.  
**Fix**: `npm run localstack:start`  

**Symptom 1**:

```sh
# ResourceNotFoundException: Cannot do operations on a non-existent table
# ...
```

**Cause**: you haven't generated local resources (tables, buckets, etc.)  
**Fix**: run `npm run gen:localresources`  

**Symptom 2**:

```sh
...bucket does not exist
```

**Cause**: you probably ran tests, which f'd up your local resources
**Fix**: `npm run reset:local`

**Symptom**: tests fail, you don't know why  
**Cause**: to be determined  
**Fix**: `npm run reset:local # delete + regen local resources (tables, buckets, etc.)`

**Symptom 3**:  

```sh
Serverless command "<some command>" not found
```

**Cause**: your `serverless.yml` is corrupted. `build:yml` probably failed the last time you ran it.  
**Fix**: fix `serverless-uncompiled.yml`, make sure `build:yml` completes successfully before retrying

**Symptom 4**:

```sh
still havent connected to local Iot broker!
```

**Cause**: something in `redis` upsets `mosca`, but what exactly is TBD
**Fix**: `npm run fix:redis`

**Symptom 5**

The log is going nuts but the mobile/web client can't seem to communicate with your local MyCloud

**Cause**: if you have multiple clients connected at once (e.g. mobile, simulator, multiple browser tabs), your machine probably just can't handle it. If you've got Dev Tools open and are debugging your lambdas, that exacerbates things. This is due to the fact that locally, the serverless environment is simulated by invoking each lambda function as if it's waking up for the first time in a docker container. It needs to `require()` everything from scratch, then run itself, then die. This is memory/computation expensive.
**Fix**: turn off the debugger, don't use more clients than your machine can handle. Yes, locally, this might only be a 2-5!

**Symptom 6**

```
Credentials Error --------------------------------------

Missing credentials in config
```

**Cause 1**: your AWS cli is not configured with your credentials
**Fix**: see [AWS cli](#aws-cli)

**Cause 2**: you may be using a global installation of `serverless` rather than the project-local one. If you're running Tradle locally via npm scripts, this should be taken care of for you. If you're running `sls` / `serverless` commands directly, make sure to use the project-local one in `node_modules`, e.g.: `./node_modules/.bin/sls offline start`

**Symptom 7**

`npm install` fails with `Authentication failed for 'https://github.com/tradle/models-corporate-onboarding.git/'` (or some other private repository it fails to pull).

**Cause 1**: you don't have access to the repository
**Fix**: check to see if you can clone that repository directly, into some other folder. If you can't, request access from Tradle

**Cause 2**: your git credentials have expired, or are not being properly cached
**Fix**: set up caching for your git credentials (varies depending on your operating system), and then check to see if you can clone that repository directly, into some other folder.

**Cause 3**: npm is having trouble with dependencies with `git://` urls.
**Fix**: open `~/.gitconfig` on your machine, and add this block:

```
[url "https://"]
  insteadOf = "git://"
```

## Troubleshooting remote deployment

**Symptom 1**

After deploying to AWS, CloudWatch logs shows:
```
module initialization error TypeError
```

**Cause**: a native module in your dependency tree was not compiled for the Amazon Linux Container
**Fix**: `npm run rebuild:lambda` and re-deploy

Keep in mind that deployment keys in S3 are based on the current git commit, so you'll need to re-commit before deploying, otherwise AWS CloudFormation will not re-deploy your lambdas with new code.

If the issue persists, you may have unknowingly introduced a new native dependency. Run `./src/scripts/list-native-modules.sh` and see if there's anything missing in the `native_modules` var in `./src/scripts/rebuild-native.sh`. If there, is, update `native_modules` and repeat the above fix.

Keep in mind that code bundle S3 keys are based on the current git commit hash, so you'll need to create a new git commit before pushing, e.g.: `git commit --allow-empty -m "chore: bust deployment cache"`

## Scripts

### npm run localstack:start

start DynamoDB and S3 in a Docker

### npm run localstack:stop

stop local DynamoDB and S3

### npm run localstack:restart

restart local DynamoDB and S3

### npm run localstack:update

update docker images

### npm run gen:localstack

generate local DynamoDB tables and S3 buckets

### npm run gen:localresources

generate local tables, buckets, identity and keys

### npm run nuke:local

delete local tables, buckets, identity and keys

### npm run reset:local

delete and recreate local resources (tables, buckets, identity)

### npm run deploy:safe

lint, run tests, rebuild native modules for the AWS Linux Container used by AWS Lambda, and deploy to AWS

### npm run test:graphqlserver

start up two UIs for browsing local data:
- a DynamoDB Admin interface
- GraphiQL

### npm run graphqlserver

starts up GraphiQL for querying remote data

### warmup

- warm up all functions with: `sls warmup run`
- warm up a subset of functions with `sls warmup run -f [function1] -f [function2] -c [concurrency]`
- estimate cost of warm ups: `sls warmup cost`

## Project Architecture

### Tools

This project uses the [Serverless](https://github.com/serverless/serverless) framework. `serverless.yml` file is thus the main configuration file for the cloud architecture you'll be deploying: tables, buckets, IaM roles, lambda functions, logs, alarms, pictures of kittens, etc.

You can set up a local playground, with most of the functionality of the cloud one right on your machine. To make this possible, this project uses [localstack](https://github.com/localstack/localstack) for simulating DynamoDB and S3 locally, and [serverless-offline](https://github.com/dherault/serverless-offline) + [mosca](https://github.com/mcollina/mosca) for simulating AWS's APIGateway and IoT broker, respectively.

### Directory Structure

```sh
./
  serverless-uncompiled.yml # npm run build:yml turns this into:
                            #   -> serverless-interpolated.yml 
                            #   -> serverless-compiled.yml
                            #   -> serverless.yml
  vars.json                 # your provider's name/domain/logo, as well as dev env opts
  src/                      # typescript code, some shell scripts
    *.ts
    scripts/                # command line scripts, and utils
    bot/                    # bot engine
    in-house-bot/           # currently co-located in-house-bot bot implementation
    test/
  lib/                      # transpiled JS code
```

### Main Components

Below you'll find the description of the various architecture components that get created when the stack is deployed.

#### Core Tables

you'll typically see table names formatted per a combination of the serverless and tradle convention, tdl-[service]-ltd-[stage]-[name] e.g. the `events` table is `tdl-tradle-ltd-dev-events` on the `dev` stage

- `events`: immutable master log
- `bucket-0`: mutable data store for data, seals, sessions, etc.

#### Buckets

- `ObjectsBucket`: stores the payloads of all messages sent/received to/from users, as well as objects created by business logic, e.g. tradle.Application (to track application state)
- `SecretsBucket`: if I told you, I'd have to kill you. It stores the private keys for your MyCloud's identity.
- `PrivateConfBucket`: public/private configuration like: identity, styles, and bot plugin configuration files
- `FileUploadBucket`: because Lambda and IoT message-size limits, any media embedded in objects sent by users is first uploaded here
- `LogsBucket`: exactly what you think
- `ServerlessDeploymentBucket`: stores past and current MyCloud deployment packages

#### Functions

Note: subject to change as lambdas are split out or collapsed together

- `jobScheduler`: lambda that fans out scheduled tasks (e.g. warming up other lambda containers, retrying failed deliveries, sending pending transactions to the blockchain, polling the blockchain for confirmations, etc.)
- `genericJobRunner`: lambda that executes tasks fanned out by `jobScheduler`
- `preauth` (HTTP): generates temporary credentials (STS) for new connections from users, attaches the IotClientRole to them, creates a new session in the `presence` table (still `unauthenticated`). Generates a challenge to be signed (verified in `auth`) \*
- `auth` (HTTP): verifies the challenge, marks the session as authenticated \*
- `oniotlifecycle` (IoT): manages the user's Iot session, attempts to deliver queued up messages depending on the user's announced send/receive position
- `inbox` (HTTP): receives batches of inbound messages (typically from other MyClouds)
- `info` (HTTP): gets the public information about this MyCloud - the identity, style, logo, country, currency, etc.
- `bot_oninit`: initializes the MyCloud node - generates an identity and keys, saves secrets and default configuration files to respective buckets. Should really be named `init` or `oninit`, but good luck getting AWS to rename something.
- `onmessage`: processes inbound messages, then hands off to synchronous business logic
- `onresourcestream`: replicates changes to immutable events table, hands off to asynchronous business logic
- `graphql`: your bot's built-in graphql API that supports existing Tradle models and custom ones you add.
- `cli`: command line lambda used for various admin tasks

\* *Note: the purpose of authentication is to know whether to send the user queued up messages. Inbound messages don't require pre-authentication, as they are all signed and can be verified without the need for a session's context.*

#### Network communication flow

1. client (Tradle mobile/web app) calls `/preauth` (`preauth` lambda) and gets a temporary identity via AWS STS. It also gets a challenge to sign.
1. client calls `/auth` with the signed challenge. At this point MyCloud deems it safe to send the client any queued up messages, and will start doing so.
1. client subscribes to AWS Iot topics restricted to its temporary identity's namespace. This allows it to receive messages, acks and errors from MyCloud. MyCloud receives these Iot lifecycle events (connect, disconnect, subscribe) in Lambda, and updates the client's session information (`iotlifecycle` lambda).
1. the client and MyCloud can send each other messages via AWS Iot.

#### Plugins

See [./docs/plugins.md](./docs/plugins.md)

#### Email templates

*Note: you don't need this unless you change the templates in `in-house-bot/templates/raw`*

To prerender templates (primarily to inline css), run `npm run prerender:templates`
