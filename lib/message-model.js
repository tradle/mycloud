module.exports = {
    "id": "tradle.Message",
    "type": "tradle.Model",
    "title": "Message",
    "properties": {
        "_n": {
            "type": "number"
        },
        "_q": {
            "type": "string"
        },
        "recipientPubKey": {
            "type": "object",
            "inlined": true,
            "properties": {
                "curve": {
                    "type": "string"
                },
                "pub": {
                    "type": "string"
                }
            }
        },
        "object": {
            "type": "object",
            "inlined": true,
            "ref": "tradle.Object"
        },
        "time": {
            "type": "date"
        },
        "context": {
            "type": "string"
        },
        "_recipient": {
            "type": "string",
            "virtual": true
        },
        "_payloadType": {
            "type": "string"
        },
        "_payloadLink": {
            "type": "string"
        },
        "_payloadAuthor": {
            "type": "string"
        }
    },
    "required": [
        "recipientPubKey",
        "object",
        "time"
    ]
};
//# sourceMappingURL=message-model.js.map