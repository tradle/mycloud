
import path = require('path')
import fs = require('fs')
import { Conf } from '../configure'
import * as Onfido from '@tradle/plugin-onfido'

type ValidateConfOpts = {
  bot: any
  conf: Conf
  pluginConf: any
  [other:string]: any
}

export interface IPluginParts {
  plugin: any
  api?: any
}

export interface IPlugin {
  name?: string
  createPlugin: (opts:any) => IPluginParts
  validateConf?: (opts:ValidateConfOpts) => Promise<void>
}

export interface IPlugins {
  [name:string]: IPlugin
}

export const Plugins:IPlugins = {}

fs.readdirSync(__dirname).forEach(file => {
  if (file !== 'index.js' && file.endsWith('.js')) {
    const plugin:IPlugin = require(path.resolve(__dirname, file))
    const name = plugin.name || path.parse(file).name
    Plugins[name] = plugin
  }
})

Plugins['customize-message'] = {
  createPlugin: require('@tradle/plugin-customize-message')
}

Plugins.onfido = Onfido
