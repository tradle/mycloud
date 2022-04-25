
import test from 'tape'
import {
  matchEvents,
  getPluginDefinitions,
  normalizePlugin,
  EventDefinitionInput,
  toEventDefinition,
  DYNAMIC_PLUGIN_CONF,
  REGISTRY_TOKEN_CONF,
  getRegistryTokens
} from '../../in-house-bot/dynamic-plugins'
import { IProductsConf, IDynamicPluginConf } from '../../in-house-bot/types'

const pass: Array<{
  pattern: EventDefinitionInput[]
  event: string
  isLocal?: boolean
}> = [
  { pattern: ['*'], event: 'some' },
  { pattern: ['some'], event: 'some' },
  { pattern: ['first', 'second'], event: 'first' },
  { pattern: ['first', 'second'], event: 'second' },
  { pattern: ['some:*'], event: 'some:' },
  { pattern: ['some:*'], event: 'some:event' },
  { pattern: ['some:*:other'], event: 'some::other' },
  { pattern: ['some:*:other'], event: 'some:event:other' },
  { pattern: [{ localOnly: true, event: 'some' }], event: 'some', isLocal: true },
]
const fail: Array<{
  pattern: EventDefinitionInput[]
  event: string
  isLocal?: true
}> = [
  { pattern: ['some'], event: 'other' },
  { pattern: [], event: 'any' },
  { pattern: ['some:*:other'], event: 'some:event:bother' },
  { pattern: [{ localOnly: true, event: 'some' }], event: 'some' },
  { pattern: [{ localOnly: true, event: 'some' }], event: 'some:*', isLocal: true }
]

test('dynamic plugins', t => {
  t.test('match various event definitions', t => {
    for (const { pattern, event, isLocal } of pass) {
      t.equal(
        matchEvents(pattern.map(toEventDefinition), event, isLocal ?? false),
        true,
        `event matches: "${event}" ... ${JSON.stringify(pattern)} (isLocal=${isLocal ?? false})`
      )
    }
    for (const { pattern, event, isLocal } of fail) {
      t.equal(
        matchEvents(pattern.map(toEventDefinition), event, isLocal ?? false),
        false,
        `event doesnt match: "${event}" ... ${JSON.stringify(pattern)} (isLocal=${isLocal ?? false})`
      )
    }
    t.end()
  })
  
  t.test('getPluginDefinitions', t => {
    t.equals(getPluginDefinitions(null), undefined)
    t.equals(getPluginDefinitions(undefined), undefined)
    t.equals(getPluginDefinitions('string' as any as IProductsConf), undefined)
    t.equals(getPluginDefinitions(1 as any as IProductsConf), undefined)
    t.equals(getPluginDefinitions({} as any as IProductsConf), undefined)
    t.equals(getPluginDefinitions([] as any as IProductsConf), undefined)
    t.throws(() => getPluginDefinitions({ [DYNAMIC_PLUGIN_CONF]: 'string' } as any as IProductsConf), new Error('dynamic-plugins needs to be a key/value object.'))
    t.throws(() => getPluginDefinitions({ enabled: [], [DYNAMIC_PLUGIN_CONF]: { foo: null } }), new Error('dynamic-plugins[foo] needs to be an object.'))
    t.throws(() => getPluginDefinitions({ enabled: [], [DYNAMIC_PLUGIN_CONF]: { foo: 'hi' } as any as IDynamicPluginConf }), new Error('dynamic-plugins[foo] needs to be an object.'))
    t.throws(() => getPluginDefinitions({ enabled: [], [DYNAMIC_PLUGIN_CONF]: { foo: {} } as any as IDynamicPluginConf }), new Error('dynamic-plugins[foo].version needs to be a string.'))
    t.throws(() => getPluginDefinitions({ enabled: [], [DYNAMIC_PLUGIN_CONF]: { foo: { version: 1 } } as any as IDynamicPluginConf }), new Error('dynamic-plugins[foo].version needs to be a string.'))
    t.deepEquals(getPluginDefinitions({ enabled: [], [DYNAMIC_PLUGIN_CONF]: { foo: { version: '1' } } }), { foo: '1' })
    t.deepEquals(getPluginDefinitions({ enabled: [], [DYNAMIC_PLUGIN_CONF]: { foo: { version: '1' }, bar: { version: 'x' } } }), { foo: '1', bar: 'x' })
    t.end()
  })

  t.test('getRegistryTokens', t => {
    t.equals(getRegistryTokens(null), undefined)
    t.equals(getRegistryTokens(undefined), undefined)
    t.equals(getRegistryTokens('string' as any as IProductsConf), undefined)
    t.equals(getRegistryTokens(1 as any as IProductsConf), undefined)
    t.equals(getRegistryTokens({} as any as IProductsConf), undefined)
    t.equals(getRegistryTokens([] as any as IProductsConf), undefined)
    t.throws(() => getRegistryTokens({ [REGISTRY_TOKEN_CONF]: 'string' } as any as IProductsConf), new Error('npm-registry-token needs to be a key/value object.'))
    t.throws(() => getRegistryTokens({ enabled: [], [REGISTRY_TOKEN_CONF]: { foo: null } }), new Error('dynamic-plugins[foo] needs to be a string.'))
    t.throws(() => getRegistryTokens({ enabled: [], [REGISTRY_TOKEN_CONF]: { foo: ' ' } }), new Error('dynamic-plugins[foo] needs to be a string.'))
    t.deepEquals(getRegistryTokens({ enabled: [], [REGISTRY_TOKEN_CONF]: { foo: 'bar' } }), { foo: 'bar' })
    t.deepEquals(getRegistryTokens({ enabled: [], [REGISTRY_TOKEN_CONF]: { foo: 'bar', baz: 'bak' } }), { foo: 'bar', baz: 'bak' })
    t.end()
  })
  
  t.test('normalizePlugin', async t => {
    async function testPlugin (conf, plugin, expected) {
      const { load, ...rest } = await normalizePlugin(conf, plugin)
      t.equals(typeof load, 'function')
      t.deepEquals(rest, expected)
    }
    await testPlugin(
      { foo: { version: 2 } },
      {
        name: 'foo',
        path: 'x',
        private: false,
        async data () {},
        async package () {
          return {
            bar: 'baz'
          }
        }
      },
      {
        name: 'foo',
        options: {
          requiresConf: false,
          prepend: false,
          events: [{ localOnly: false, event: '*' }],
          componentName: null
        },
        conf: undefined
      }
    )
    await testPlugin(
      { foo: { version: 2, someconf: 'a' } },
      {
        name: 'foo',
        path: 'x',
        private: false,
        async data () {},
        async package () {
          return {
            mycloud: {
              requiresConf: true,
              componentName: 'some'
            }
          }
        }
      },
      {
        name: 'foo',
        options: {
          requiresConf: true,
          prepend: false,
          events: [{ localOnly: false, event: '*' }],
          componentName: 'some'
        },
        conf: { someconf: 'a' }
      }
    )
    await testPlugin(
      { foo: { version: 2, someconf: 'b', otherconf: 'c' } },
      {
        name: 'foo',
        path: 'x',
        private: false,
        async data () {},
        async package () {
          return {
            mycloud: {
              prepend: true,
              events: ['message', { localOnly: true, event: 'resourcestream' }, { event: 'other' }]
            }
          }
        }
      },
      {
        name: 'foo',
        options: {
          requiresConf: false,
          prepend: true,
          events: [{ localOnly: false, event: 'message' }, { localOnly: true, event: 'resourcestream' }, { localOnly: false, event: 'other' }],
          componentName: null
        },
        conf: { someconf: 'b', otherconf: 'c' }
      }
    )
    t.end()
  })
})
