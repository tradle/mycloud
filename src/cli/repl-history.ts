import os from 'os'
import path from 'path'
import fs from 'fs'

/**
 * Save a repl's history
 * @param  {Object}     opts
 * @param  {REPLServer} opts.server
 * @param  {String}     opts.prompt
 * @param  {String}     [opts.path]
 */
export default function installHistory (opts) {
  const { prompt, server } = opts
  const filename = promptToFilename(prompt) || '.tradle-cli-history'
  const historyPath = opts.path || path.join(os.homedir(), filename)

  if (fs.existsSync(historyPath)) {
    fs.readFileSync(historyPath, { encoding: 'utf8' })
      .split('\n')
      .reverse()
      .filter(line => line.trim())
      .forEach(line => server.history.push(line))
  }

  server.on('exit', function () {
    // don't dedupe as history might be used as a build script later
    //
    // ...however:
    //   history may be hard to turn into a build script because
    //   it's not easy to tell sync/async functions apart
    //
    // const deduped = []
    // server.lines.forEach(line => {
    //   if (line !== deduped[deduped.length - 1]) {
    //     deduped.push(line)
    //   }
    // })

    fs.appendFileSync(historyPath, '\n' + server.lines.join('\n'), { encoding: 'utf8' })
  })
}

function promptToFilename (prompt) {
  const filename = prompt.replace(/[^a-zA-Z0-9\-_]+/g, '')
  if (filename) return '.' + filename
}
