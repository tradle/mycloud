### Just to test your job to see if it responds if it does not need all the server functionality
```
node --inspect ./node_modules/.bin/serverless invoke local --function genericJobRunner  --data '{"name":"youJob"}' 
```

## If you need to run the server to test your job, change but DO NOT commit!!!
### serverless-uncompiled.yml   
```
  genericJobRunner:  
    handler: lib/in-house-bot/lambda/job-runner.handler
    memorySize: 1024
    timeout: 900
    alarms:
      - functionErrors
      - functionInvocations
    events:
      - http:
          path: jobs
          method: get
          cors: ${{self:custom.cors}}
```

### job-runner.ts
instead of
```
  lambda.use(async (ctx) => {
    const job: Job = ctx.event
```
add this
```
  lambda.use(async ctx => {
    const job: Job = ctx.event.queryStringParameters || ctx.event
```
and after
```
  await bot.fire(`job:${job.name}`, { job, components })
```
add this
```
  ctx.body = {}
```

## To run/debug you job : start the server in debug mode and type in browser URL:
```
  localhost:21012/jobs?name=[your job name]
```
