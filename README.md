
# tradle/aws

## Usage

You should have docker running. The below scripts will first rebuild the native modules for the AWS linux environment

```sh
# deploy to localstack
npm run rebuild && npm run deploy:local

# deploy to aws
npm run rebuild && npm run deploy:aws
```
