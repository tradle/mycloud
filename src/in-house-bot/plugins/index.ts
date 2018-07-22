
import { IPlugins } from '../types'
import { loadFromDir } from '../registry'

const Plugins:IPlugins = loadFromDir({ dir: __dirname })
Plugins.set('customize-message', {
  createPlugin: require('@tradle/plugin-customize-message')
})

export { Plugins }
