module.exports = {
  'tradle.Ping': {
    id: 'tradle.Ping',
    title: 'Ping',
    type: 'tradle.Model',
    properties: {
      _time: {
        type: 'number',
        virtual: true
      }
    }
  },
  'tradle.Pong': {
    id: 'tradle.Pong',
    title: 'Pong',
    type: 'tradle.Model',
    properties: {
      _time: {
        type: 'number',
        virtual: true
      }
    }
  }
}
