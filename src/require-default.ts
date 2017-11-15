type ModuleMap = { [key: string]: any }
type Require = (module:string) => any

const requireDefault:Require = (() => {
  const cache:ModuleMap = {}

  return (path:string) => {
    if (!cache[path]) {
      const result = require(path)
      cache[path] = result.__esModule && result.default ? result.default : result
    }

    return cache[path]
  }
})()

export { requireDefault }
