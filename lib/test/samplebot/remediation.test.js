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
require('../env').install();
const test = require("tape");
const sinon = require("sinon");
const constants_1 = require("@tradle/constants");
const remediation_1 = require("../../samplebot/remediation");
const remediation_2 = require("../../samplebot/plugins/remediation");
const utils_1 = require("../../utils");
const Errors = require("../../errors");
const logger_1 = require("../../logger");
const bot_1 = require("../../bot");
const constants_2 = require("../../samplebot/constants");
const models = require("../../models");
const dataBundle = require('../fixtures/data-bundle.json');
const { DATA_CLAIM, FORM } = constants_2.TYPES;
test('remediation plugin', utils_1.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const claim = {
        [constants_1.TYPE]: DATA_CLAIM,
        [constants_1.SIG]: 'somesig',
        claimId: 'abc'
    };
    const user = { id: 'bob' };
    const bot = bot_1.createBot();
    const productsAPI = {
        send: sinon.stub().callsFake(({ to, object }) => __awaiter(this, void 0, void 0, function* () {
            const { items } = object;
            t.equal(items.length, dataBundle.items.length);
            t.ok(items.every(item => {
                const isForm = models[item[constants_1.TYPE]].subClassOf === FORM;
                return item[constants_1.SIG] && (!isForm || item[constants_1.OWNER] === user.id);
            }));
        }))
    };
    const remediation = new remediation_2.Remediation({
        bot,
        productsAPI,
        logger: new logger_1.Logger('test:remediation1'),
        getBundleByClaimId: (id) => __awaiter(this, void 0, void 0, function* () {
            t.equal(id, claim.claimId);
            return dataBundle;
        }),
        onClaimRedeemed: ({ user, claimId }) => __awaiter(this, void 0, void 0, function* () {
            t.equal(claimId, claim.claimId);
        })
    });
    t.doesNotThrow(() => remediation.validateBundle(dataBundle));
    const plugin = remediation_2.createPlugin({ remediation });
    yield plugin[`onmessage:${DATA_CLAIM}`]({
        user,
        payload: claim
    });
    t.equal(productsAPI.send.callCount, 1);
    t.end();
})));
test.only('remediation api', utils_1.loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const bundle = {
        items: [
            {
                _t: 'tradle.WealthCV',
                narrative: 'got rich'
            },
            {
                _t: 'tradle.Verification',
                document: 0,
                dateVerified: 12345
            }
        ]
    };
    const user = { id: 'b5da273e0254479d5e611a1ded1effecf751e6e6588dc6648fc21f5e036961c0' };
    const bot = bot_1.createBot();
    const remediator = new remediation_1.Remediator({
        bot,
        productsAPI: {
            plugins: {
                use: ({ onmessage }) => { }
            }
        },
        logger: new logger_1.Logger('test:remediation')
    });
    const stub = yield remediator.genClaimStub({ bundle });
    t.same(remediation_1.parseClaimId(stub.claimId), {
        key: stub.key,
        nonce: stub.nonce
    });
    const key = yield remediator.saveUnsignedDataBundle(bundle);
    const { claimId } = yield remediator.createClaim({ key });
    const saved = yield remediator.getBundleByClaimId({ claimId });
    t.same(saved, bundle);
    yield remediator.onClaimRedeemed({ user, claimId });
    try {
        yield remediator.getBundleByClaimId({ claimId });
        t.fail('expected claim to have been deleted');
    }
    catch (err) {
        t.ok(Errors.matches(err, Errors.NotFound));
    }
    t.end();
})));
//# sourceMappingURL=remediation.test.js.map