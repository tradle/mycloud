import repl from 'repl'
import co from 'co'
import { pick } from 'lodash'
import installHistory from './repl-history'
import { isPromise } from '../utils'

/**
 * REPL singleton
 * @param  {String} options.prompt
 * @param  {bot}    options.bot
 * @return {REPLServer}
 */
export default function createReplServer ({ prompt, cli }) {
  const server = promisify(repl.start({
    prompt,
    ignoreUndefined: true
  }))

  installHistory({ prompt, server })

  const { context } = server
  context.co = co

  Object.assign(context, {
    cli,
    get bot() {
      return cli.bot
    },
    get productsAPI() {
      return cli.productsAPI
    },
    get onfidoPlugin() {
      return cli.onfidoPlugin
    },
    ...pick(cli.tradle, [
      'env',
      'dbUtils',
      'lambdaUtils',
      'tables',
      'buckets',
      'objects',
      'secrets',
      'provider',
      'db',
      'messages',
      'identities',
      'friends',
      'seals',
      'blockchain',
      'auth',
      'kv',
      'conf'
    ])
  })

  // function print ({ user, object }) {
  //   console.log(user.id, JSON.stringify(object, null, 2))
  //   server.displayPrompt()
  // }

  // function help () {
  //   const helpPath = path.resolve(__dirname, '../docs/repl-help.txt')
  //   fs.createReadStream(helpPath)
  //     .on('end', server.displayPrompt.bind(server))
  //     .pipe(process.stdout)
  // }

  return server

  // const initScript = process.argv[2]
  // if (initScript) {
  //   const scriptBody = fs.readFileSync(path.resolve(initScript), { encoding: 'utf8' })
  //   vm.createContext(context)
  //   vm.runInContext(scriptBody, context)
  //   server.displayPrompt()
  // }
}

// source: https://github.com/mvertes/co-shell
// (with minor adaptations)
function promisify (server) {
  const originalEval = server.eval

  server.eval = function (cmd, context, filename, callback) {
    if (cmd.match(/\W*(?:yield|await)\s+/)) {
      cmd = 'co(function* () { return ' +
        cmd.replace(/(\W*)await(\s+)/g, '$1yield$2')
          .replace(/^\s*var\s+/, '') +
      '})'
    }

    originalEval.call(server, cmd, context, filename, function (err, res) {
      if (err || !isPromise(res)) {
        return callback(err, res)
      }

      res.then(
        result => callback(null, result),
        callback
      )
    })
  }

  return server
}
