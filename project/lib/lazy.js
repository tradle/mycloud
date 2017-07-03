
// from bcoin
module.exports = function lazy (require, exports) {
  return function _require (name, path) {
    let cache
    exports.__defineGetter__(name, function () {
      if (!cache) cache = require(path)

      return cache
    })
  }
}
