import createNamespace from 'debug'
import { Writer } from './logger'

const { name } = require('../package.json')
const levels = ['log', 'error', 'warn', 'info', 'debug', 'silly', 'ridiculous']
const COLORS = {
  error: 1, // red
  warn: 3, // yellow
  info: 6, // blue
  // info: 2, // green
  silly: 4, //'purple',
  ridiculous: 5 // pink
}

export default (testing: boolean) => {
  if (!testing) return global.console

  return levels.reduce((writer, level) => {
    const debug = createNamespace(`${name}:${level}`)
    if (level in COLORS) debug.color = COLORS[level]

    writer[level] = debug
    return writer
  }, {}) as Writer
}
