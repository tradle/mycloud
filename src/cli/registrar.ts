import Send from './commands/send'
import ClearTables from './commands/clear-tables'

const commands = {}

export const register = (name, command) => {
  commands[name] = command
}

export const get = name => {
  const ctor = commands[name]
  if (!name) {
    throw new Error(`command "${name}" not found`)
  }

  return ctor
}

export const list = () => Object.keys(commands)

register('clear-tables', ClearTables)
register('send', Send)
