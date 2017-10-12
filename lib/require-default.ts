type ModuleMap = { [key: string]: any }

exports.requireDefault = (() => {
  const cache:ModuleMap = {}

  return (path:string) => {
    if (!cache[path]) {
      const result = require(path)
      cache[path] = result.__esModule ? result.default : result
    }

    return cache[path]
  }
})()
