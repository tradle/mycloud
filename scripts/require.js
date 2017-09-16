const path = require('path')
const core = [
  "assert",
  "zlib",
  "buffer",
  "inherits",
  "console",
  "constants",
  "crypto",
  "dns",
  "domain",
  "events",
  "http",
  "https",
  "os",
  "path",
  "process",
  "punycode",
  "querystring",
  "fs",
  "dgram",
  "stream",
  "string_decoder",
  "timers",
  "tty",
  "url",
  "util",
  "net",
  "vm",
  "tls"
]

module.exports = function requireWithProjectFolderAsRoot (name) {
  if (core.includes(name)) {
    return require(name)
  }

  if (name[0] === '.') {
    name = path.join('../project', name)
  } else {
    name = path.join('../project/node_modules', name)
  }

  return require(name)
}
