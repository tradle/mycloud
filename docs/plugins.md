
# Plugins

How to develop plugins for the in-house bot. This is a lightweight alternative to developing your own chat bot.

## How Plugins Work

There are two components to plugins:

### The code

When developing a plugin, it's currently easiest to develop it inside this project itself. Later, you can always export it to a separate npm module. See some example plugins in `../src/samplebot/plugins/`

Plugins export any number of life-cycle methods defined by the in-house bot. The bot will call those methods at the appropriate time, with the predetermined arguments

Plugins are attached to the in-house bot in [samplebot/index.ts](../src/samplebot/index.ts). Some day soon they will be attached automatically based on some configuration, but today you need to add something like this:

```ts
if (plugins['lens']) {
  logger.debug('using plugin: lens')
  productsAPI.plugins.use(createLensPlugin({
    ...commonPluginOpts,
    conf: plugins['lens'],
    logger: logger.sub('plugin-lens')
  }))
}
```

Plugins can inject themselves into a number of different events by exporting a method to handle that event.

- willSend (and didSend)
- willRequestForm
- willApproveApplication (and didApproveApplication)
- willDenyApplication (and didDenyApplication)
- getRequiredForms
- validateForm
- onmessage
- onmessage:[model.id] - e.g. 'onmessage:tradle.CustomerWaiting'
- onmessage:[model.subClassOf] - e.g. 'onmessage:tradle.Form'
- onFormsCollected

### Example

The plugin below intercepts inbound messages carrying `tradle.Shmortz`, whatever that is. It calls a third party API to evaluate the received data, and potentially approves the application.

Before building your plugin, you probably want to create some kind of API wrapper for the plugin to use, to make things more easily testable.

```ts

export const createPlugin = ({ 
  // src/bot/index.ts Bot instance
  bot, 
  // @tradle/bot-products module instance from provider.js
  productsAPI, 
  // a logger for the plugin to use
  logger,
  // custom conf as designed for this plugin
  conf
}) => {
  const myApi = new MyApi(opts.credentials)
  const handleShmortz = async (req) => {
    const { 
      user,
      application, 
      payload 
    } = req

    const result = await myApi.askMyDataSource({
      glopz: Math.sqrt(payload.googa)
      shmortz: payload.pantsColor / payload.brainTriangles
    })

    if (result.success) {
      await productsAPI.approveApplication({ req, user, application })
    } else {
      await productsAPI.sendSimpleMessage({
        req,
        to: user,
        message: 'your shmortz is below the pink average. Please come back later.'
      })
    }
  }

  const didApproveApplication = async ({ req, user, application }) => {
    console.log('whatever')
  }

  return {
    didApproveApplication,
    [`onmessage:tradle.Shmortz`]: handleShmortz
  }
}
```

See some simple examples in `src/samplebot/plugins`: `set-name`, `ts-and-cs`, `keep-fresh`, `lens`, `form-prefill`

See more complex examples: `centrix`, `complyAdvantage`, `onfido`, `deployment`, `remediation`

`productsAPI` doesn't have typescript typings yet, but once it does, you'll have auto-completion for your plugin coding.
