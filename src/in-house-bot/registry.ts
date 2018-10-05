import path from 'path'
import fs from 'fs'
import caseless from 'caseless'
import { Registry } from '../types'

const DEFULT_FILTER = file => file !== 'index.js' && file.endsWith('.js')
const DEFAULT_GET_ALIASES = item => ([]) // no aliases

type GetAliases = (item: any) => string[]

export const loadFromDir = <T>({ dir, filter=DEFULT_FILTER, prop, getAliases=DEFAULT_GET_ALIASES }: {
  dir: string
  filter?: (item: any) => boolean|void
  prop?: string
  getAliases?: GetAliases
}):Registry<T> => {
  const registry = caseless({})
  registry.keys = () => Object.keys(registry.dict)
  fs.readdirSync(dir).forEach(file => {
    if (!filter(file)) return

    const subModule = require(path.resolve(dir, file))
    const item = prop ? subModule[prop] : subModule
    const name = item.name || path.parse(file).name
    const aliases = getAliases(item) || []
    const names = [name].concat(aliases)
    names.forEach(name => {
      if (registry.get(name)) {
        throw new Error(`multiple items registered with name: ${name}`)
      }

      registry.set(name, item)
    })
  })

  return registry
}
