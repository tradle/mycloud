module.exports = require('./models')['tradle.Seal'] || {
  "type": "tradle.Model",
  "id": "tradle.Seal",
  "title": "Seal",
  "description": "a seal on a blockchain for an object",
  "properties": {
    "link": {
      "type": "string",
      "readOnly": true,
      "immutable": true
    },
    "txId": {
      "type": "string",
      "readOnly": true,
      "immutable": true
    },
    "blockchain": {
      "type": "string",
      "readOnly": true,
      "immutable": true
    },
    "network": {
      "type": "string",
      "readOnly": true,
      "immutable": true
    },
    "time": {
      "type": "date",
      "readOnly": true,
      "immutable": true
    }
  },
  "required": [
    "link",
    "txId",
    "blockchain",
    "network"
  ]
}
