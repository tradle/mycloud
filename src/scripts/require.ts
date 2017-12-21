const path = require('path')
const globalRequire = require

export = function requireOverride (modulePath) {
  if (modulePath[0] !== '.') {
    return globalRequire(modulePath)
  }

  modulePath = path.resolve(__dirname, '../scripts', modulePath)
  console.log(modulePath)
  return globalRequire(modulePath)
}
