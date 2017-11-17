"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const coexpress = require("co-express");
function attachInboxHandler({ tradle, router }) {
    const { user, logger } = tradle;
    const messageHandler = coexpress(function* (req, res) {
        const event = req.body;
        const { message } = event;
        const result = yield user.onSentMessage({ message });
        res.json(result);
    });
    app.post('/message', messageHandler);
    app.put('/message', messageHandler);
}
exports.default = attachInboxHandler;
//# sourceMappingURL=message.js.map