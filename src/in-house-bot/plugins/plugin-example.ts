import fetch from 'node-fetch'
import { TYPE } from '@tradle/constants'
import {
  Conf,
  CreatePlugin,
  IPluginOpts,
  ValidatePluginConf,
  IPluginLifecycleMethods,
} from '../types'

interface MyPluginConf {
  apiKey: string
}

interface MyPluginOpts extends IPluginOpts {
  conf: MyPluginConf
}

export const name = 'plugin-example'

// dummy API, usually this would be in a separate module
class MyApi {
  private apiKey: string
  constructor(apiKey) {
    this.apiKey = apiKey
  }

  public isAlive = async ({ firstName, lastName }: {
    firstName: string
    lastName: string
  }) => {
    const res = await fetch('.../some-api', {
      method: 'POST',

    })

    if (!res.ok) {
      throw new Error(res.statusText)
    }

    const { status } = await res.json()
    return status === 'alive'
  }

  public runSomeOtherQuery = async input => {
    // dummy stub
    return {}
  }
}

export const createPlugin:CreatePlugin<MyApi> = ({
  // other components

  // src/bot/index.ts Bot instance
  bot,
  // products strategy api
  productsAPI,
  // in-house-bot/applications.ts
  applications,
}, {
  // plugin-specific

  // a logger for the plugin to use
  logger,
  // configuration as designed for this plugin
  // it's the block you put in conf/bot.json "plugins" section
  conf,
}:  MyPluginOpts) => {
  const api = new MyApi({ apiKey: conf.apiKey })
  const checkIsAlive = async ({ firstName, lastName }) => {
    const isAlive = await api.isAlive({ firstName, lastName })
    if (isAlive) {
      // do something
    } else {
      // do something else
    }
  }

  const plugin:IPluginLifecycleMethods = {
    ['onmessage:tradle.Form']: async (req) => {
      const { payload } = req
      if (payload[TYPE] === 'tradle.Name') {
        await checkIsAlive({ firstName: payload.givenName, lastName: payload.surname })
      }
    },
    onFormsCollected: async ({ req }) => {
      await api.runSomeOtherQuery({ /*..*/ })
    }
  }

  return {
    api,
    plugin
  }
}

export const validateConf:ValidatePluginConf = async ({ conf, pluginConf }) => {
  // validate pluginConf
}
