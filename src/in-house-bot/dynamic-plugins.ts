import { PluginDefinitions, loadPlugins, Plugin } from '@tradle/lambda-plugins'
import { IPlugin, IProductsConf } from './types'
import { typeforce } from '../utils'
import * as types from '../typeforce-types'

export const DYNAMIC_PLUGIN_CONF = 'dynamic-plugins'
export const REGISTRY_TOKEN_CONF = 'npm-registry-tokens'

export interface EventDefinition {
  localOnly?: boolean
  event: string
}

export type EventDefinitionInput = string | (Omit<Partial<EventDefinition>, 'event'> & { event: string })

export function toEventDefinition (input: EventDefinitionInput): EventDefinition {
  if (typeof input === 'string') {
    return {
      localOnly: false,
      event: input
    }
  }
  return {
    localOnly: !!input.localOnly,
    event: input.event
  }
}

export function matchEvents (events: EventDefinition[], actual: string, isLocal: boolean): boolean {
  for (const { event, localOnly } of events) {
    if (localOnly && !isLocal) continue
    if (event === '*') {
      return true
    }
    let starIndex = event.indexOf('*')
    if (starIndex === -1) {
      if (event === actual) {
        return true
      }
      continue
    }
    const prefix = event.substring(0, starIndex)
    if (!actual.startsWith(prefix)) continue
    if (starIndex === event.length - 1) return true
    const suffix = event.substring(starIndex + 1)
    if (actual.endsWith(suffix)) return true
  }
  return false
}

export interface DynamicPluginOptions {
  requiresConf: boolean
  events: EventDefinition[]
  prepend: boolean
  componentName?: string
}

export interface DynamicPluginPackage {
  mycloud?: Omit<Partial<DynamicPluginOptions>, 'events'> & {
    events: Array<EventDefinitionInput>
  }
}

export interface DynamicPlugin {
  name: string
  version: string
  load: () => Promise<IPlugin<any>>
  // plugin: Plugin
  options: DynamicPluginOptions
  conf?: { [key: string]: any }
}

export async function getDynamicPlugins (conf: IProductsConf): Promise<DynamicPlugin[]> {
  const pluginDefinitions = getPluginDefinitions(conf)
  if (pluginDefinitions === undefined) {
    return []
  }
  const dynamicConf = conf[DYNAMIC_PLUGIN_CONF]
  const dynamicPlugins = await loadPlugins(pluginDefinitions, {
    strict: false,
    failQuietly: false,
    registryTokens: getRegistryTokens(conf)
  })
  return await Promise.all(Object.values(dynamicPlugins).map(plugin => normalizePlugin(dynamicConf, plugin)))
}

export async function normalizePlugin (dynamicConf: { [key: string]: any }, plugin: Plugin): Promise<DynamicPlugin> {
  const pkg = await plugin.package()
  return {
    name: plugin.name,
    version: pkg.version,
    async load () {
      let data
      try {
        data = await plugin.data()
      } catch (err) {
        throw new Error(`dynamic-plugin "${plugin.name}" can not be loaded: ${err.message}`)
      }
      try {
        typeforce(types.plugin, data)
      } catch (err) {
        throw new Error(`dynamic-plugin "${plugin.name}" doesnt correctly implement the plugin interface. ${err}`)
      }
      return data
    },
    options: normalizePackageJSONOptions(pkg),
    conf: normalizeDynamicPluginConf(dynamicConf[plugin.name])
  }
}

export function getPluginDefinitions (conf: IProductsConf): PluginDefinitions | undefined {
  if (typeof conf !== 'object' || conf === null) {
    return
  }
  const dynamicConf = conf[DYNAMIC_PLUGIN_CONF]
  if (dynamicConf === undefined || dynamicConf === null) {
    return
  }
  if (typeof dynamicConf !== 'object' || Array.isArray(dynamicConf)) {
    throw new Error(`${DYNAMIC_PLUGIN_CONF} needs to be a key/value object.`)
  }
  let pluginDefinitions: PluginDefinitions
  for (const [name, pConf] of Object.entries(dynamicConf)) {
    if (typeof pConf !== 'object' || pConf === null) {
      throw new Error(`${DYNAMIC_PLUGIN_CONF}[${name}] needs to be an object.`)
    }
    const version = pConf['version']
    if (typeof version !== 'string') {
      throw new Error(`${DYNAMIC_PLUGIN_CONF}[${name}].version needs to be a string.`)
    }
    if (pluginDefinitions === undefined) {
      pluginDefinitions = {}
    }
    pluginDefinitions[name] = version
  }
  return pluginDefinitions
}

export function getRegistryTokens (conf: IProductsConf): { [registry: string]: string } | undefined {
  if (typeof conf !== 'object' || conf === null) {
    return
  }
  const registryConf = conf[REGISTRY_TOKEN_CONF]
  if (registryConf === undefined || registryConf === null) {
    return
  }
  if (typeof registryConf !== 'object') {
    throw new Error(`${REGISTRY_TOKEN_CONF} needs to be an key/value object.`)
  }
  let registryTokens: { [registry: string]: string }
  for (const [registry, token] of Object.entries(registryConf)) {
    if (typeof token !== 'string' || token.trim() === '') {
      throw new Error(`${REGISTRY_TOKEN_CONF}[${registry}] needs to be a string.`)
    }
    if (registryTokens === undefined) {
      registryTokens = {}
    }
    registryTokens[registry] = token.trim()
  }
  return registryTokens
}

function normalizeDynamicPluginConf (conf: any) {
  const { version, ...rest } = conf
  for (const _key in rest) {
    // only use the rest of the configuration if a property is defined
    return rest
  }
}

function normalizePackageJSONOptions (pkg: any): DynamicPluginOptions {
  typeforce(types.pluginPackage, pkg)
  const pluginPkg: DynamicPluginPackage = pkg
  let events: EventDefinition[] = [{ localOnly: false, event: '*' }]
  const defaults = {
    requiresConf: false,
    prepend: false,
    events,
    componentName: null
  }
  const { mycloud: plugin } = pluginPkg
  if (!plugin) {
    return defaults
  }
  if (Array.isArray(plugin.events)) {
    events = plugin.events.map(toEventDefinition)
  }
  return {
    ...defaults,
    events,
    requiresConf: !!plugin.requiresConf,
    prepend: !!plugin.prepend,
    componentName: plugin.componentName ?? null
  }
}
