export const models = {
  'ping.pong.Ping': {
    id: 'ping.pong.Ping',
    title: 'Ping',
    type: 'tradle.Model',
    properties: {
      _time: {
        type: 'number',
        virtual: true
      }
    }
  },
  'ping.pong.Pong': {
    id: 'ping.pong.Pong',
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
