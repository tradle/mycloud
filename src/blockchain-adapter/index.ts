// lazy load
export default {
  get bitcoin () {
    return require('./bitcoin')
  },
  get ethereum () {
    return require('./ethereum')
  },
  get corda (){
    return require('./corda')
  }
}
