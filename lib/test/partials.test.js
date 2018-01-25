"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("tape");
const sinon = require("sinon");
const engine = require("@tradle/engine");
const constants_1 = require("@tradle/constants");
const partials_1 = require("../samplebot/plugins/partials");
test('partials', (t) => __awaiter(this, void 0, void 0, function* () {
    const productsAPI = {
        send: sinon.stub()
    };
    const { onmessage } = partials_1.createPlugin({
        bot: {},
        productsAPI,
        conf: {
            getRecipients: ({ message, payload }) => {
                return ['abc'];
            },
            filterValues: ({ object, property }) => {
                return property === 'message';
            }
        }
    });
    yield onmessage({
        req: {},
        message: {
            context: 'somecontext'
        },
        payload: {
            [constants_1.SIG]: 'somesig',
            [constants_1.TYPE]: 'tradle.SimpleMessage',
            message: 'hey'
        }
    });
    t.equal(productsAPI.send.callCount, 1);
    const { object, to } = productsAPI.send.getCall(0).args[0];
    t.equal(to, 'abc');
    t.ok(engine.partial.verify(object));
    const props = engine.partial.interpretLeaves(object.leaves);
    t.same(props, [{ key: 'message', value: 'hey' }]);
    t.end();
}));
//# sourceMappingURL=partials.test.js.map