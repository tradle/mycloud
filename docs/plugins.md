# Plugins

See below how to develop plugins for the in-house bot. This is a lightweight alternative to developing your own chat bot.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**

- [How Plugins Work](#how-plugins-work)
- [Code](#code)
- [Configuration](#configuration)
- [Example](#example)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## How Plugins Work

There are two kinds of plugins, in-house and dynamic.

The in-house bot has a number of lifecycle methods that can be implemented by plugins. The bot will call your implementation at the appropriate time, with the predetermined (but not yet well-documented) arguments.

There are two components to plugins, code and configuration. If the code says "call the FBI and check if the applicant's kids eat their vegetables," the configuration says when to make this call, the API key to the FBI's Veggie Spy API, etc. The code and configuration are deployed and managed separately.

Dynamic plugins are very similar to in-house plugins in their function but will be downloaded to the lambda storage when the lambda function is warmed up. They are loaded after in-house plugins while they behave mostly same, below some differences will be noted.

## Code

When developing a plugin, it's currently easiest to develop it inside this project itself. Later, you can always export it to a separate npm module. Place your plugin into the folder `../src/in-house-bot/plugins/`

Plugins are attached to the in-house bot in [in-house-bot/index.ts](../src/in-house-bot/index.ts). Eventually they will be attached automatically based on some configuration object, but today you need to add something like this:

```ts
if (handleMessages) {
  // this will enable your plugin to handle incoming messages from customers (e.g. forms)
  attachPlugin({ name: 'lens' })
}
```

Plugins can implement (export) the following lifecycle methods (see `../src/in-house-bot/plugin-types.d.ts` for typings for the in-house plugins
and [@tradle/mycloud-plugin-api][] for dynamic plugins):

[@tradle/mycloud-plugin-api]: https://github.com/tradle/mycloud-plugin-api

### Synchronous (when a message is received from a user)

- `willSend` - called before a message is sent to a user
- `willRequestForm` - called before a user is asked to fill out a form. If you want to prefill the form for the user, this is where to do it.
- `willCreateApplication` - called before a new application is created for a user
- `willDenyApplication` - called before an application is denied
- `willApproveApplication` - called before an application is approved
- `willDenyApplication` - called before an application is denied
- `getRequiredForms` - called to determine which forms are required from a user for a product
- `validateForm` - called to validate a user-sent form
- `onFormsCollected` - called when the forms for a product have been collected from a user
- `onmessage` - handle an incoming message (the most general handler for user message)
- `onmessage:[model.id]` - handle a type of incoming message, e.g. tradle.CustomerWaiting, or tradle.ProductRequest
- `onmessage:[model.subClassOf]` - handle incoming messages that subclass a type, e.g.  to handle all subclasses of tradle.Form, export 'onmessage:tradle.Form'

- `onmessage` - handle an incoming message (the most general handler for user message)

### Asynchronous (when a db record changes)

- `onResourceChanged` - called when a resource changed, e.g. the `lastName` value changed on a `tradle.Name` form
- `onCheckStatusChanged` - a special case of `onResourceChanged`, for convenience purposes

### Dynamic plugin 

## Configuration

The configuration for plugins is kept separate and managed and deployed with [tradleconf](https://github.com/tradle/tradleconf). Configuration is deployed separately, and more rapidly than code.

For example, the configuration for the lens plugin in Safe-Re (a default Tradle Sandbox provider, see https://app.tradle.io) looks like this:

```json
  "plugins" {
    ...
    "lens": {
      "nl.tradle.DigitalPassport": {
        "tradle.PhotoID": "io.safere.lens.PhotoID"
      },
      "tradle.pg.CustomerOnboarding": {
        "tradle.Address": "io.safere.lens.Address"
      }
    },
    ...
  },
  "dynamic-plugins": {
    ...
    "@tradle/some-plugin": {
      "version": "~1.0.0",
      "some-option": "some-value"
    }
    ...
  },
  "npm-registry-tokens": {
    ...
    "registry.npm.org": "npm_Abqr6rPnh4ovRAjhGU2q9qbbjG16ijRrgTw"
    ...
  }
```

The format of your configuration object is up to you. To make sure someone doesn't deploy invalid configuration, you should provide a `validateConf` export in your plugin. For example, see the [validateConf](https://github.com/tradle/serverless/blob/master/src/in-house-bot/plugins/lens.ts#L60) export in the Lens plugin.

Dynamic plugins have the additional property `version` that will not be exposed to `validateConf` or `updateConf` it specifies the location of the plugin. A [semver][] range indicates to load it from the [npm registry][], while a `https:` or `s3:` url to a `.tgz` file (created by `npm pack`) can also be specified.

To support [private npm packages][] you can specify `npm-registry-tokens` per domain that will be used to download the package from.

[semver]: https://semver.org/
[npm registry]: https://docs.npmjs.com/cli/v7/using-npm/registry
[private npm packages]: https://docs.npmjs.com/about-private-packages/

## Example

The plugin below intercepts inbound messages carrying `tradle.Shmortz`, whatever that is. It calls a third party API to evaluate the received data, and potentially approves the application.

Before building your plugin, you probably want to create some kind of API wrapper for the plugin to use, to make things more easily testable.

```ts

import { Conf, IPluginOpts } from '../types'

export const createPlugin = (
  // other components
  { 
    // src/bot/index.ts Bot instance
    bot, 
    // products strategy api
    productsAPI
  }, 
  // plugin-specific
  {
    // a logger for the plugin to use
    logger,
    // configuration as designed for this plugin
    conf
  }
) => {
  const myApi = new MyApi(conf.credentials)
  const handleShmortz = async (req) => {
    const { 
      user,
      application, 
      payload 
    } = req

    const result = await myApi.askMyDataSource({
      glopz: Math.sqrt(payload.googa)
      fleg: payload.pantsColor / payload.brainTriangles
    })

    if (result.success) {
      await productsAPI.approveApplication({ req, user, application })
    } else {
      await productsAPI.sendSimpleMessage({
        req,
        to: user,
        message: 'your shmortz is below the pink average. Have a grafkl, it usually helps'
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

export const validateConf = async ({ conf, pluginConf }: {
  conf: Conf,
  pluginConf: any
}) => {
  // .. validate your plugin configuration
}

```

See some simple examples in `src/in-house-bot/plugins`: `set-name`, `ts-and-cs`, `keep-fresh`, `lens`, `form-prefill`, `required-forms`

See more complex examples: `centrix`, `complyAdvantage`, `onfido`, `deployment`, `remediation`

`productsAPI` doesn't have typescript typings yet, but once it does, you'll have auto-completion for your plugin coding.

## Template

To take advantage of static type checking as it becomes more available, use the template below for building your plugin in `src/in-house-bot/plugins/`.

```ts
import { Conf, CreatePlugin, IPluginLifecycleMethods } from '../types'
import { MyApi } from 'my-api'

export const createPlugin:CreatePlugin<MyApi> = (
  // other components
  { 
    // src/bot/index.ts Bot instance
    bot, 
    // products strategy api
    productsAPI
  }, 
  // plugin-specific
  {
    // a logger for the plugin to use
    logger,
    // configuration as designed for this plugin
    conf
  }
) => {
  const { bot, productsAPI } = components
  // "conf" is from the block you put in conf/bot.json and deployed
  const { conf, logger } = opts
  const api = new MyApi({ whatever: 'opts' })
  const plugin:IPluginLifecycleMethods = {
    ['onmessage:tradle.Form']: async (req) => {
      const { user, payload } = req
      await api.runSomeQuery({ user, payload })
    },
    onFormsCollected: async ({ req }) => {
      const { user, payload } = req
      await api.runSomeOtherQuery({ user, payload })      
    }
  }

  return {
    api,
    plugin
  }
}

export const validateConf = ({
  conf: Conf
  pluginConf: any
}) => {
  // validate pluginConf
}
```

## Dynamic Plugins

Basically, dynamic plugins are to be written much like regular plugins. The difference being
that they live in their own package to be installed.

To know when the plugin should be processed, you have new properties in the `package.json` that
allows to specify _when_ the plugin should be loaded.

```js
{
  "name": "my-dynamic-plugin",
  "version": "1.2.3",
  "main": "index.js",              // It will load the definitions from the file defined here.
  "mycloud": {
    "requiresConf": true,          // You can add a switch to only use this plugin if configuration is present.
    "prepend": true,               // By default plugins gets appended after other plugins but the
                                   // prepend switch will let the plugin installed at the beginning.
    "componentName": "short",      // It is also possible to change the component name under which
                                   // the component will be registered, by default its the package name.
    "events": [                    // List of events where the plugin is used, without specified it will be used at ALL events.
      "message",                   // You can specify simple event names ...
      "documentChecker:*",         // ... or specify one placeholder like * for a group of events with prefix ...
      "*:change",                  // ... and/or suffix
      {                            // Alternatively you can specify an event object ...
        "event": "resourcestream", // ... where the event is noted in the event property ...
        "localOnly": true          // ... and by setting localOnly, the event is only used in a local env.
      }
    ]
  }
}
```

### Dynamic Plugins: TypeScript

For typescript to compile we prepared the [@tradle/mycloud-plugin-api][] npm package that contains
only interfaces for the plugin process.

**IMPORTANT NOTE:** `@tradle/mycloud-plugin-api` is currently **not** integrated or verified by mycloud!
This means that the types in there are _guides_ at the moment.

[@tradle/mycloud-plugin-api]: https://github.com/tradle/mycloud-plugin-api

### Dynamic Plugin: Dependencies

As dynamic plugins will be loaded at start time of a lambda it is recommended to 
make the plugins as small as possible and do not include heavy dependencies if at-all possible or
packages that need to be compiled on installation. The more functionality you can use through
[@tradle/mycloud-plugin-api][] the better! If there is an important general-purpose library that
you may need to access, send a PR to mycloud that provides that library and exposes it to the 
plugins!

### Dynamic Plugins: Deployment

You have different options to deploy private plugins, but generally the two ways are to use
an direct location (https:// or s3:// path) or an npm registry to deploy plugins to.

When using an npm registry you can take advantage of semver ranges, meaning that the system will
automatically install the latest dependencies on cold boot. This can be a blessing as patches and
fixes will be automatically deployed. But it also leaves up the possibility to supply-chain attacks.

Another issue with registries is that the registries need to be up and the a downtime of the registry
can mean the downtime of the mycloud. (see [@tradle/lambda-plugins#9][] for a possible solution to
this) but even when the registries are up chances are at they are slower than using the same data
from s3.

[@tradle/lambda-plugins#9]: https://github.com/tradle/lambda-plugins/issues/9

The alternative is that you [bundle] all dependencies 
