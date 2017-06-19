// lazy load
module.exports = {
  get bitcoin() {
    return require('./bitcoin')
  },
  get ethereum() {
    return require('./ethereum')
  }
}
