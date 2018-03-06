import fs from 'fs'
import path from 'path'
import mkdirp from 'mkdirp'
import minimist from 'minimist'
import Cli from './'
import createRepl from './repl'
import { list as listCommands } from './registrar'

const { remote } = minimist(process.argv.slice(2), {
  alias: {
    r: 'remote'
  },
  default: {
    remote: false
  }
})

if (remote) {
  console.warn(`WARNING: this cli controls your remote AWS environment and resources`)
}

const logsDir = path.resolve(__dirname, '../../logs')
mkdirp.sync(logsDir)

const logPath = path.join(logsDir, `cli-log-${new Date().toISOString()}.log`)
const logStream = fs.createWriteStream(logPath, {'flags': 'a'})
const cli = new Cli({ remote })
;(async () => {
  await cli.ready

  cli.setWriter({
    log: (...args) => {
      args.unshift(new Date().toLocaleString())
      const str = args.join(' ') + '\n'
      logStream.write(str)
    }
  }, true) // propagate to sub-writers

  // shortcuts
  listCommands().forEach(name => {
    cli[name] = opts => cli.exec(name, opts)
  })

  createRepl({
    prompt: '\uD83C\uDF36  ',
    cli
  })
})()
