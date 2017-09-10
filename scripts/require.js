const path = require('path')

module.exports = function requireWithProjectFolderAsRoot (name) {
  if (name[0] === '.') {
    name = path.join('../project', name)
  } else {
    name = path.join('../project/node_modules', name)
  }

  return require(name)
}
