
import path from 'path'
import fs from 'fs'
import caseless from 'caseless'
import { Conf } from '../configure'
import * as Onfido from '@tradle/plugin-onfido'
import { IPlugin, IPlugins } from '../types'

const Plugins:IPlugins = caseless({})

fs.readdirSync(__dirname).forEach(file => {
  if (file !== 'index.js' && file.endsWith('.js')) {
    const plugin:IPlugin<any> = require(path.resolve(__dirname, file))
    const name = plugin.name || path.parse(file).name
    Plugins.set(name, plugin)
  }
})

Plugins.set('customize-message', {
  createPlugin: require('@tradle/plugin-customize-message')
})

Plugins.set('onfido', Onfido)

export { Plugins }
