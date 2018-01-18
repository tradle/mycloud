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
const nock = require('nock');
require('./env').install();
const test = require("tape");
const sinon = require("sinon");
const constants_1 = require("@tradle/constants");
const crypto_1 = require("../crypto");
const utils_1 = require("./utils");
const tradle_1 = require("../tradle");
const Errors = require("../errors");
const aliceKeys = require('./fixtures/alice/keys');
const bobKeys = require('./fixtures/bob/keys');
const aliceIdentity = require('./fixtures/alice/identity');
const bobIdentity = require('./fixtures/bob/identity');
crypto_1.addLinks(aliceIdentity);
crypto_1.addLinks(bobIdentity);
const blockchainOpts = {
    flavor: 'ethereum',
    networkName: 'rinkeby'
};
const SealsTableLogicalId = 'SealsTable';
const rejectEtherscanCalls = () => {
    nock('http://rinkeby.etherscan.io/')
        .get(uri => uri.startsWith('/api'))
        .reply(function () {
        rejectEtherscanCalls();
        return {
            statusCode: 403,
            body: '403 - Forbidden: Access is denied.'
        };
    });
};
rejectEtherscanCalls();
test('handle failed reads/writes', (t) => __awaiter(this, void 0, void 0, function* () {
    const { flavor, networkName } = blockchainOpts;
    const table = yield utils_1.recreateTable(SealsTableLogicalId);
    const txId = 'sometxid';
    const tradle = new tradle_1.default();
    const { blockchain, seals } = tradle;
    const aliceKey = aliceKeys.find(key => key.type === flavor && key.networkName === networkName);
    const bobKey = bobKeys.find(key => key.type === flavor && key.networkName === networkName);
    const stubGetTxs = sinon.stub(blockchain, 'getTxsForAddresses').resolves([]);
    yield seals.create({ key: aliceKey, link: aliceIdentity._link });
    yield seals.watch({ key: bobKey, link: bobIdentity._link });
    let unconfirmed = yield seals.getUnconfirmed();
    t.equal(unconfirmed.length, 1);
    let failedReads = yield seals.getFailedReads({ gracePeriod: 1 });
    t.equal(failedReads.length, 1);
    const stubSeal = sinon.stub(seals.blockchain, 'seal').resolves({ txId: 'sometxid' });
    yield seals.sealPending();
    let failedWrites = yield seals.getFailedWrites({ gracePeriod: 1 });
    t.equal(failedWrites.length, 1);
    let longUnconfirmed = yield seals.getLongUnconfirmed({ gracePeriod: 1 });
    t.equal(longUnconfirmed.length, 2);
    const spyBatchPut = sinon.spy(seals.table, 'batchPut');
    yield seals.handleFailures({ gracePeriod: 1 });
    t.equal(spyBatchPut.callCount, 2);
    spyBatchPut.getCalls().forEach(({ args }) => {
        const [expired] = args;
        t.equal(expired.length, 1);
        if (expired[0].link === failedReads[0].link) {
            t.ok(expired[0].unwatched);
        }
        else {
            t.same(expired[0].link, failedWrites[0].link);
            t.ok(expired[0].unsealed);
        }
    });
    let unsealed = yield seals.getUnsealed();
    t.equal(unsealed.length, 1);
    t.equal(stubSeal.callCount, 1);
    yield seals.sealPending();
    t.equal(stubSeal.callCount, 2);
    t.end();
}));
test('queue seal', (t) => __awaiter(this, void 0, void 0, function* () {
    const { flavor, networkName } = blockchainOpts;
    const table = yield utils_1.recreateTable(SealsTableLogicalId);
    const sealedObj = aliceIdentity;
    const link = sealedObj._link;
    const permalink = sealedObj._permalink;
    const txId = 'sometxid';
    const tradle = new tradle_1.default();
    const { blockchain, seals } = tradle;
    const key = aliceKeys.find(key => key.type === flavor && key.networkName === networkName);
    const address = blockchain.sealAddress({
        link,
        basePubKey: key
    });
    let sealed;
    const stubSeal = sinon.stub(blockchain, 'seal')
        .callsFake((sealInfo) => __awaiter(this, void 0, void 0, function* () {
        t.same(sealInfo.addresses, [address]);
        sealed = true;
        return { txId };
    }));
    const stubGetTxs = sinon.stub(blockchain, 'getTxsForAddresses')
        .callsFake(function (addresses, blockHeight) {
        return Promise.resolve([
            {
                txId,
                confirmations: 10000,
                to: {
                    addresses: [address]
                }
            }
        ]);
    });
    const stubObjectsGet = sinon.stub(tradle.objects, 'get')
        .callsFake((_link) => __awaiter(this, void 0, void 0, function* () {
        if (_link === link) {
            return sealedObj;
        }
        throw new Error('NotFound');
    }));
    const stubObjectsPut = sinon.stub(tradle.objects, 'put')
        .callsFake((object) => __awaiter(this, void 0, void 0, function* () {
        t.equal(object._seal.link, link);
        t.equal(object._seal.txId, txId);
    }));
    const stubDBUpdate = sinon.stub(tradle.db, 'update')
        .callsFake((props) => __awaiter(this, void 0, void 0, function* () {
        t.equal(props[constants_1.TYPE], sealedObj[constants_1.TYPE]);
        t.equal(props._permalink, permalink);
        t.equal(props._seal.link, link);
        t.equal(props._seal.txId, txId);
    }));
    const stubDBGet = sinon.stub(tradle.db, 'get')
        .callsFake((props) => __awaiter(this, void 0, void 0, function* () {
        if (props._permalink === permalink) {
            return sealedObj;
        }
        throw new Errors.NotFound(permalink);
    }));
    yield seals.create({ key, link, permalink });
    let unconfirmed = yield seals.getUnconfirmed();
    t.equal(unconfirmed.length, 0);
    let unsealed = yield seals.getUnsealed();
    t.equal(unsealed.length, 1);
    t.equal(unsealed[0].address, address);
    yield seals.sealPending();
    unsealed = yield seals.getUnsealed();
    t.equal(unsealed.length, 0);
    unconfirmed = yield seals.getUnconfirmed();
    t.equal(unconfirmed.length, 1);
    let longUnconfirmed = yield seals.getLongUnconfirmed({ gracePeriod: 1 });
    t.equal(longUnconfirmed.length, 1);
    longUnconfirmed = yield seals.getLongUnconfirmed({ gracePeriod: 1000 });
    t.equal(longUnconfirmed.length, 0);
    yield seals.syncUnconfirmed();
    unconfirmed = yield seals.getUnconfirmed();
    t.equal(unconfirmed.length, 0);
    t.same(yield seals.getLongUnconfirmed(), []);
    const seal = yield seals.get({ link });
    t.equal(seal.address, address);
    t.equal(seal.link, link);
    t.equal(stubObjectsGet.callCount, 1);
    t.equal(stubObjectsPut.callCount, 1);
    t.equal(stubDBUpdate.callCount, 1);
    stubSeal.restore();
    stubGetTxs.restore();
    stubObjectsGet.restore();
    stubDBUpdate.restore();
    t.end();
}));
//# sourceMappingURL=seals.test.js.map