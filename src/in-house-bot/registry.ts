import path from 'path'
import fs from 'fs'
import caseless from 'caseless'
import { Registry } from '../types'

const DEFULT_FILTER = file => file !== 'index.js' && file.endsWith('.js')

export const loadFromDir = <T>({ dir, filter=DEFULT_FILTER, prop }: {
  dir: string
  filter?: Function
  prop?: string
}):Registry<T> => {
  const registry = caseless({})
  registry.keys = () => Object.keys(registry.dict)
  fs.readdirSync(dir).forEach(file => {
    if (!filter(file)) return

    const subModule = require(path.resolve(dir, file))
    const item = prop ? subModule[prop] : subModule
    const name = item.name || path.parse(file).name
    if (registry.get(name)) {
      debugger
      throw new Error(`multiple items registered with name: ${name}`)
    }

    registry.set(name, item)
  })

  return registry
}
