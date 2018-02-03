
import path = require('path')
import fs = require('fs')
import { Conf } from '../configure'

type ValidateConfOpts = {
  bot: any
  conf: Conf
  pluginConf: any
  [other:string]: any
}

type Plugin = {
  name?: string
  createPlugin: Function
  validateConf?: (opts:ValidateConfOpts) => Promise<void>
}

type Plugins = {
  [name:string]: Plugin
}

const plugins:Plugins = {}

fs.readdirSync(__dirname).forEach(file => {
  if (file !== 'index.js' && file.endsWith('.js')) {
    const plugin:Plugin = require(path.resolve(__dirname, file))
    const name = plugin.name || path.parse(file).name
    plugins[name] = plugin
  }
})

plugins['customize-message'] = require('@tradle/plugin-customize-message')

export = plugins
