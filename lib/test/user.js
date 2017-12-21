"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("tape");
const _1 = require("../");
const utils_1 = require("../utils");
const alice = require('./fixtures/alice/object');
const bob = require('./fixtures/bob/object');
const fromBob = require('./fixtures/alice/receive.json');
test('onSentMessage', utils_1.loudCo(function* (t) {
    try {
        yield _1.tradle.user.onSentMessage({
            clientId: `${bob.permalink}blah`,
            message: { blah: 1 }
        });
        t.fail('expected InvalidMessageFormat error');
    }
    catch (err) {
        t.equal(err.name, 'InvalidMessageFormat');
    }
    t.end();
}));
//# sourceMappingURL=user.js.map