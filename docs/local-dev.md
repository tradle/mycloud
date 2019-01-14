
## Receiving HTTP requests from the outside

Sometimes you want to be able to receive HTTP requests from the outside world, e.g. to test a webhook integration.

Here's how to do it:

in one Terminal tab run:
```sh
ngrok http 21012 # this is the default port from default-vars.json
```

In the other, run your Serverless Offline server:

```
SERVERLESS_OFFLINE_APIGW=<NGROK_URL> ./node_modules/.bin/sls offline start
```

In the code, this base url will be available as `bot.apiBaseUrl`

Of course, you also have to have a lambda registered in `serverless-uncompiled.yml` for HTTP events on a given path. Aand don't forget to `npm run build:yml` and restart Serverless Offline after any changes to that file.
