
import path from 'path'
import fs from 'fs'
import { ICommand } from '../types'

const commands = {}

fs.readdirSync(__dirname).forEach(file => {
  if (file !== 'index.js' && file.endsWith('.js')) {
    const command:ICommand = require(path.resolve(__dirname, file)).command
    const name = command.name || path.parse(file).name
    commands[name] = command
  }
})

module.exports = commands
