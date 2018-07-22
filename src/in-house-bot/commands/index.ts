
import { loadFromDir } from '../registry'
import { ICommand, Registry } from '../types'

export const Commands: Registry<ICommand> = loadFromDir({ dir: __dirname, prop: 'command' })
