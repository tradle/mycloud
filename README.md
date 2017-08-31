
# tradle/aws

## Setup

Run Docker, set up aws credentials in ~/.aws/

```sh
npm run setup
```

## Directory Structure

```sh
.              # dev dependencies, serverless framework config
  /cli         # ignore me for now
  /scripts     # various helper scripts in `./scripts`
  /project     # code that will be deployed to lambda
    /conf      # various table schemas, used for tests
    /lib
      /bot     # bot engine
    /samplebot # currently co-located sample bot in `./project/samplebot`
```

### Deploy

```sh
# make sure docker is running
docker ps
# 1. lint & test
# 2. rebuild native modules with AWS Linux container
# 3. deploy to cloud
npm run deploy:safe
```

### Destroy

Sometimes you want to wipe the slate clean and start from scratch (usually by age 25 or so). The following command will wipe out all the AWS resources created in your deployment. Obviously, use with EXTREME caution, as this command executes with your AWS credentials (best use a separate account).

```sh
npm run nuke
# a series of y/n prompts ensues, 
# ensuring you're committed to the destruction of all that is holy
```
