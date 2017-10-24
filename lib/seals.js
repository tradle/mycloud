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
const utils_1 = require("./utils");
const dbUtils = require("./db-utils");
const types = require("./typeforce-types");
const Errors = require("./errors");
const MAX_ERRORS_RECORDED = 10;
const WATCH_TYPE = {
    this: 't',
    next: 'n'
};
const YES = 'y';
const notNull = val => !!val;
class Seals {
    constructor({ provider, blockchain, tables, network, env }) {
        this.watch = ({ key, link }) => {
            return this.createSealRecord({ key, link, write: false });
        };
        this.watchNextVersion = ({ key, link }) => {
            const type = WATCH_TYPE.next;
            return this.createSealRecord({ key, link, type, write: false });
        };
        this.create = ({ key, link }) => __awaiter(this, void 0, void 0, function* () {
            return this.createSealRecord({ key, link, write: true });
        });
        this.get = (seal) => __awaiter(this, void 0, void 0, function* () {
            const { link } = seal;
            const { id } = yield this.table.findOne({
                IndexName: 'link',
                KeyConditionExpression: 'link = :link',
                ExpressionAttributeValues: {
                    ':link': link
                }
            });
            return this.table.get({
                Key: { id }
            });
        });
        this.recordWriteSuccess = ({ seal, txId }) => __awaiter(this, void 0, void 0, function* () {
            utils_1.typeforce(utils_1.typeforce.String, txId);
            this.debug(`sealed ${seal.link} with tx ${txId}`);
            const update = {
                txId,
                confirmations: 0,
                timeSealed: utils_1.timestamp(),
                unsealed: null
            };
            const params = dbUtils.getUpdateParams(update);
            params.Key = getKey(seal);
            yield this.table.update(params);
            return utils_1.clone(seal, update);
        });
        this.recordWriteError = ({ seal, error }) => __awaiter(this, void 0, void 0, function* () {
            this.debug(`failed to seal ${seal.link}`, error.stack);
            const errors = addError(seal.errors, error);
            const params = dbUtils.getUpdateParams({ errors });
            params.Key = getKey(seal);
            return this.table.update(params);
        });
        this._sealPending = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            utils_1.typeforce({
                limit: utils_1.typeforce.maybe(utils_1.typeforce.Number),
                key: utils_1.typeforce.maybe(types.privateKey)
            }, opts);
            const { blockchain, provider, getUnsealed, recordWriteSuccess, recordWriteError } = this;
            let { limit = Infinity, key } = opts;
            if (!key) {
                key = yield provider.getMyChainKey();
            }
            const pending = yield this.getUnsealed({ limit });
            this.debug(`found ${pending.length} pending seals`);
            let aborted;
            const results = yield utils_1.seriesMap(pending, (sealInfo) => __awaiter(this, void 0, void 0, function* () {
                if (aborted)
                    return;
                const { link, address } = sealInfo;
                const addresses = [address];
                let result;
                try {
                    result = yield this.blockchain.seal({ addresses, link, key });
                }
                catch (error) {
                    if (/insufficient/i.test(error.message)) {
                        this.debug(`aborting, insufficient funds, send funds to ${key.fingerprint}`);
                        aborted = true;
                    }
                    yield this.recordWriteError({ seal: sealInfo, error });
                    return;
                }
                const { txId } = result;
                yield this.recordWriteSuccess({
                    seal: sealInfo,
                    txId
                });
                return { txId, link };
            }));
            return results.filter(notNull);
        });
        this.createSealRecord = (opts) => __awaiter(this, void 0, void 0, function* () {
            const seal = this.getNewSealParams(opts);
            try {
                yield this.table.put({
                    Item: seal,
                    ConditionExpression: 'attribute_not_exists(link)',
                });
            }
            catch (err) {
                if (err.code === 'ConditionalCheckFailedException') {
                    const dErr = new Errors.Duplicate();
                    dErr.link = seal.link;
                    throw dErr;
                }
                throw err;
            }
        });
        this._syncUnconfirmed = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            const { blockchain, getUnconfirmed, network, table } = this;
            blockchain.start();
            const unconfirmed = yield getUnconfirmed(opts);
            if (!unconfirmed.length)
                return;
            const addresses = unconfirmed.map(({ address }) => address);
            const txInfos = yield blockchain.getTxsForAddresses(addresses);
            if (!txInfos.length)
                return;
            const addrToSeal = {};
            addresses.forEach((address, i) => {
                addrToSeal[address] = unconfirmed[i];
            });
            const updates = {};
            for (const txInfo of txInfos) {
                const { txId } = txInfo;
                const to = txInfo.to.addresses;
                for (const address of to) {
                    if (!addrToSeal[address])
                        continue;
                    const seal = addrToSeal[address];
                    const { confirmations = 0 } = txInfo;
                    if (seal.confirmations >= confirmations)
                        continue;
                    updates[address] = {
                        txId,
                        confirmations,
                        unconfirmed: confirmations < network.confirmations ? YES : null
                    };
                }
            }
            if (!Object.keys(updates).length) {
                this.debug(`blockchain has nothing new for ${addresses.length} synced addresses`);
                return;
            }
            yield Promise.all(Object.keys(updates).map((address) => __awaiter(this, void 0, void 0, function* () {
                const update = updates[address];
                const seal = addrToSeal[address];
                const params = dbUtils.getUpdateParams(update);
                params.Key = getKey(seal);
                yield table.update(params);
            })));
        });
        this.getNewSealParams = ({ key, link, watchType = WATCH_TYPE.this, write = true, blockchainIdentifier }) => {
            const { blockchain } = this;
            let pubKey;
            if (watchType === WATCH_TYPE.this) {
                pubKey = blockchain.sealPubKey({ link, basePubKey: key });
            }
            else {
                pubKey = blockchain.sealPrevPubKey({ prevLink: link, basePubKey: key });
            }
            const address = blockchain.pubKeyToAddress(pubKey.pub);
            const params = {
                id: utils_1.uuid(),
                blockchain: blockchainIdentifier || blockchain.toString(),
                link,
                address,
                pubKey,
                watchType,
                write: true,
                time: utils_1.timestamp(),
                confirmations: -1,
                errors: [],
                unconfirmed: YES
            };
            if (write) {
                params.unsealed = YES;
            }
            return params;
        };
        utils_1.typeforce(types.blockchain, blockchain);
        utils_1.bindAll(this);
        this.provider = provider;
        this.blockchain = blockchain;
        this.table = tables.Seals;
        this.network = network;
        this.env = env;
        this.debug = env.logger('seals');
        const scanner = IndexName => (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            const { limit = Infinity } = opts;
            const query = {
                TableName: this.table.name,
                IndexName
            };
            if (limit !== Infinity) {
                query.Limit = limit;
            }
            return this.table.scan(query);
        });
        this.getUnconfirmed = scanner('unconfirmed');
        this.getUnsealed = scanner('unsealed');
        this.sealPending = blockchain.wrapOperation(this._sealPending);
        this.syncUnconfirmed = blockchain.wrapOperation(this._syncUnconfirmed);
    }
}
exports.default = Seals;
function addError(errors = [], error) {
    errors = errors.concat({
        time: utils_1.timestamp(),
        stack: error.stack
    });
    if (errors.length > MAX_ERRORS_RECORDED) {
        errors = errors.slice(errors.length - MAX_ERRORS_RECORDED);
    }
    return errors;
}
function getKey(sealInfo) {
    return { id: sealInfo.id };
}
//# sourceMappingURL=seals.js.map