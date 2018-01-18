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
const _ = require("lodash");
const buildResource = require("@tradle/build-resource");
const constants_1 = require("@tradle/constants");
const utils_1 = require("./utils");
const string_utils_1 = require("./string-utils");
const dbUtils = require("./db-utils");
const types = require("./typeforce-types");
const Errors = require("./errors");
const models_1 = require("@tradle/models");
const SealModel = models_1.models['tradle.Seal'];
const SEAL_MODEL_ID = 'tradle.Seal';
const MAX_ERRORS_RECORDED = 10;
const WATCH_TYPE = {
    this: 't',
    next: 'n'
};
const RESEAL_ENABLED = false;
const DEFAULT_WRITE_GRACE_PERIOD = 6 * 3600 * 1000;
const TIMESTAMP_MULTIPLIER = 1e3;
const YES = 'y';
const notNull = val => !!val;
class Seals {
    constructor({ provider, blockchain, network, tables, db, objects, env }) {
        this.watch = (opts) => {
            return this.createSealRecord(Object.assign({}, opts, { write: false }));
        };
        this.watchNextVersion = (opts) => {
            return this.createSealRecord(Object.assign({}, opts, { watchType: WATCH_TYPE.next, write: false }));
        };
        this.create = (opts) => __awaiter(this, void 0, void 0, function* () {
            return this.createSealRecord(Object.assign({}, opts, { write: true }));
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
            this.logger.info(`sealed ${seal.link} with tx ${txId}`);
            const update = {
                txId,
                confirmations: 0,
                timeSealed: utils_1.timestamp(),
                unsealed: null
            };
            const params = dbUtils.getUpdateParams(update);
            params.Key = getKey(seal);
            yield this.table.update(params);
            return Object.assign({}, seal, update);
        });
        this.recordWriteError = ({ seal, error }) => __awaiter(this, void 0, void 0, function* () {
            this.logger.error(`failed to seal ${seal.link}`, { error: error.stack });
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
            this.logger.info(`found ${pending.length} pending seals`);
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
                        this.logger.error(`aborting, insufficient funds, send funds to ${key.fingerprint}`);
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
                    throw new Errors.Duplicate('duplicate seal with link', seal.link);
                }
                throw err;
            }
        });
        this.getUnsealed = (opts) => __awaiter(this, void 0, void 0, function* () {
            return yield this.table.scan(maybeLimit({
                IndexName: 'unsealed'
            }, opts));
        });
        this.getUnconfirmed = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            return yield this.table.scan(maybeLimit({
                IndexName: 'unconfirmed',
                FilterExpression: 'attribute_not_exists(#unsealed) AND attribute_not_exists(#unwatched)',
                ExpressionAttributeNames: {
                    '#unsealed': 'unsealed',
                    '#unwatched': 'unwatched'
                }
            }, opts));
        });
        this.getLongUnconfirmed = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            const { gracePeriod = DEFAULT_WRITE_GRACE_PERIOD } = opts;
            const longAgo = utils_1.timestamp() - gracePeriod * TIMESTAMP_MULTIPLIER;
            return yield this.table.scan(maybeLimit({
                IndexName: 'unconfirmed',
                FilterExpression: '#confirmations < :confirmations AND #time < :longAgo',
                ExpressionAttributeNames: {
                    '#confirmations': 'confirmations',
                    '#time': 'time'
                },
                ExpressionAttributeValues: {
                    ':confirmations': this.network.confirmations,
                    ':longAgo': longAgo
                }
            }, opts));
        });
        this.handleFailures = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            const { gracePeriod = DEFAULT_WRITE_GRACE_PERIOD } = opts;
            const failures = yield this.getLongUnconfirmed(opts);
            const failedWrites = [];
            const failedReads = [];
            for (const seal of failures) {
                if (isFailedWrite({ seal, gracePeriod })) {
                    failedWrites.push(seal);
                }
                else {
                    failedReads.push(seal);
                }
            }
            const [requeuedWrites, canceledReads] = yield Promise.all([
                this._requeueWrites(failedWrites),
                this._cancelReads(failedReads)
            ]);
            return {
                requeuedWrites,
                canceledReads
            };
        });
        this.getFailedReads = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            const { gracePeriod = DEFAULT_WRITE_GRACE_PERIOD } = opts;
            return yield this.table.scan(maybeLimit({
                IndexName: 'unconfirmed',
                FilterExpression: 'attribute_not_exists(#unsealed) AND attribute_exists(#unconfirmed) AND #time < :longAgo',
                ExpressionAttributeNames: {
                    '#unsealed': 'unsealed',
                    '#unconfirmed': 'unconfirmed',
                    '#time': 'time'
                },
                ExpressionAttributeValues: {
                    ':longAgo': utils_1.timestamp() - gracePeriod * TIMESTAMP_MULTIPLIER
                }
            }, opts));
        });
        this.getFailedWrites = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            const { gracePeriod = DEFAULT_WRITE_GRACE_PERIOD } = opts;
            return yield this.table.scan(maybeLimit({
                IndexName: 'unconfirmed',
                FilterExpression: 'attribute_not_exists(#unsealed) AND attribute_exists(#txId) AND #timeSealed < :longAgo',
                ExpressionAttributeNames: {
                    '#unsealed': 'unsealed',
                    '#txId': 'txId',
                    '#timeSealed': 'timeSealed'
                },
                ExpressionAttributeValues: {
                    ':longAgo': utils_1.timestamp() - gracePeriod * TIMESTAMP_MULTIPLIER
                }
            }, opts));
        });
        this.requeueFailedWrites = (opts) => __awaiter(this, void 0, void 0, function* () {
            const unconfirmed = yield this.getFailedWrites(opts);
            yield this._requeueWrites(unconfirmed);
        });
        this._requeueWrites = (seals) => __awaiter(this, void 0, void 0, function* () {
            if (!seals.length)
                return;
            this.logger.debug('failed writes', seals.map(seal => _.pick(seal, ['timeSealed', 'txId'])));
            const now = utils_1.timestamp();
            const puts = seals.map(seal => {
                return Object.assign({}, _.omit(seal, ['unconfirmed', 'txId']), { unsealed: String(now), txId: null });
            });
            yield this.table.batchPut(puts);
            return seals;
        });
        this._cancelReads = (seals) => __awaiter(this, void 0, void 0, function* () {
            if (!seals.length)
                return;
            this.logger.debug('failed reads', seals.map(seal => _.pick(seal, ['address', 'link'])));
            const now = utils_1.timestamp();
            const puts = seals.map(seal => {
                return Object.assign({}, _.omit(seal, 'unconfirmed'), { unwatched: String(now) });
            });
            yield this.table.batchPut(puts);
            return seals;
        });
        this._syncUnconfirmed = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            const changed = [];
            const { blockchain, getUnconfirmed, network, table } = this;
            blockchain.start();
            const unconfirmed = yield getUnconfirmed(opts);
            if (!unconfirmed.length) {
                this.logger.info(`no unconfirmed transactions`);
                return changed;
            }
            const addresses = unconfirmed.map(({ address }) => address);
            const txInfos = yield blockchain.getTxsForAddresses(addresses);
            if (!txInfos.length)
                return changed;
            const addrToSeal = {};
            const linkToSeal = {};
            addresses.forEach((address, i) => {
                const seal = unconfirmed[i];
                addrToSeal[address] = seal;
                linkToSeal[seal.link] = seal;
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
                    seal.txId = txId;
                    seal.confirmations = confirmations;
                    if (confirmations >= network.confirmations) {
                        delete seal.unconfirmed;
                        changed.push(seal);
                    }
                }
            }
            if (!changed.length) {
                this.logger.info(`blockchain has nothing new for ${addresses.length} synced addresses`);
                return changed;
            }
            const updateSeals = this.table.batchPut(changed);
            const links = Object.keys(linkToSeal);
            const updateObjectsAndDB = Promise.all(links.map((link) => __awaiter(this, void 0, void 0, function* () {
                const seal = linkToSeal[link];
                let object;
                try {
                    object = yield this.objects.get(link);
                }
                catch (err) {
                    this.logger.error(`object not found, skipping objects+db update with confirmed seal`, {
                        link,
                        seal: seal.id,
                        error: err.stack
                    });
                    return;
                }
                const sealResource = _.pick(seal, Object.keys(SealModel.properties));
                sealResource[constants_1.TYPE] = SEAL_MODEL_ID;
                if (_.isEqual(object._seal, sealResource))
                    return;
                buildResource.setVirtual(object, {
                    _seal: sealResource
                });
                this.logger.debug(`updating resource with seal`, utils_1.summarizeObject(object));
                const before = yield this.db.get(_.pick(object, [constants_1.TYPE, '_permalink']));
                yield Promise.all([
                    this.db.update(Object.assign({}, _.pick(object, [constants_1.TYPE, '_time', '_link', '_permalink', '_virtual']), { _seal: sealResource })),
                    this.objects.put(object)
                ]);
                const saved = yield this.db.get(_.pick(object, [constants_1.TYPE, '_permalink']));
                const lost = Object.keys(object).filter(p => !(p in saved));
                if (lost.length) {
                    this.logger.debug(`lost properties ${lost.join(', ')}`);
                    this.logger.debug(`before in s3: ${string_utils_1.prettify(object)}, before in db: ${string_utils_1.prettify(before)}, after: ${string_utils_1.prettify(saved)}`);
                }
            })));
            yield Promise.all([
                updateSeals,
                updateObjectsAndDB
            ]);
            return changed;
        });
        this.getNewSealParams = ({ key, link, permalink, watchType = WATCH_TYPE.this, write }) => {
            const { blockchain, network } = this;
            let pubKey;
            if (watchType === WATCH_TYPE.this) {
                pubKey = blockchain.sealPubKey({ link, basePubKey: key });
            }
            else {
                pubKey = blockchain.sealPrevPubKey({ prevLink: link, basePubKey: key });
            }
            const address = blockchain.pubKeyToAddress(pubKey.pub);
            const time = utils_1.timestamp();
            const params = {
                id: utils_1.uuid(),
                blockchain: network.flavor,
                network: network.networkName,
                link,
                address,
                pubKey,
                watchType,
                write: true,
                time,
                confirmations: -1,
                errors: [],
                unconfirmed: String(time)
            };
            if (permalink) {
                params.permalink = permalink;
            }
            if (write) {
                params.unsealed = String(time);
            }
            return params;
        };
        utils_1.typeforce(types.blockchain, blockchain);
        utils_1.bindAll(this);
        this.provider = provider;
        this.blockchain = blockchain;
        this.table = tables.Seals;
        this.network = network;
        this.objects = objects;
        this.db = db;
        this.env = env;
        this.logger = env.sublogger('seals');
        this.sealPending = blockchain.wrapOperation(this._sealPending);
        this.syncUnconfirmed = blockchain.wrapOperation(this._syncUnconfirmed);
    }
}
exports.default = Seals;
exports.Seals = Seals;
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
function isFailedWrite({ seal, gracePeriod = DEFAULT_WRITE_GRACE_PERIOD }) {
    if (seal.txId) {
        const deadline = seal.timeSealed + gracePeriod * TIMESTAMP_MULTIPLIER;
        return utils_1.timestamp() > deadline;
    }
}
function maybeLimit(params, opts) {
    if (opts && opts.limit) {
        params.Limit = opts.limit;
    }
    return params;
}
//# sourceMappingURL=seals.js.map