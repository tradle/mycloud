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
const { utils, protocol } = require('@tradle/engine');
const { promisify, typeforce } = require('./utils');
const { prettify } = require('./string-utils');
const adapters = require('./blockchain-adapter');
class Blockchain {
    constructor(tradle) {
        this.writers = {};
        this.getTxAmount = () => this.network.minOutputAmount;
        this.createAdapter = (opts = {}) => {
            const { flavor, networkName } = this;
            const create = adapters[flavor];
            return create(Object.assign({ flavor, networkName }, opts));
        };
        this.getWriter = (key) => {
            const { fingerprint, priv } = key;
            if (!this.writers[fingerprint]) {
                const { transactor } = this.createAdapter({
                    privateKey: priv
                });
                this.writers[fingerprint] = promisify(transactor);
            }
            return this.writers[fingerprint];
        };
        this.startOrStop = (method) => __awaiter(this, void 0, void 0, function* () {
            Object.keys(this.writers)
                .map(key => this.writers[key])
                .concat(this.reader.blockchain)
                .forEach(client => {
                if (client[method]) {
                    client[method]();
                }
            });
        });
        this.toString = () => `${this.network.blockchain}:${this.network.name}`;
        this.pubKeyToAddress = (...args) => this.network.pubKeyToAddress(...args);
        this.wrapOperation = fn => {
            return (...args) => __awaiter(this, void 0, void 0, function* () {
                this.start();
                try {
                    return yield fn(...args);
                }
                finally {
                    this.stop();
                }
            });
        };
        this.getBlockHeight = () => __awaiter(this, void 0, void 0, function* () {
            this.start();
            const { blockHeight } = yield this.getInfo();
            return blockHeight;
        });
        this.getTxsForAddresses = (addresses, blockHeight) => __awaiter(this, void 0, void 0, function* () {
            this.start();
            const txInfos = yield this.addressesAPI.transactions(addresses, blockHeight);
            txInfos.forEach((info) => {
                if (!info.confirmations &&
                    typeof info.blockHeight === 'number' &&
                    typeof blockHeight === 'number') {
                    info.confirmations = blockHeight - info.blockHeight;
                }
            });
            if (txInfos.length) {
                this.logger.debug(`fetched transactions for addresses: ${addresses.join(', ')}: ${prettify(txInfos)}`);
            }
            else {
                this.logger.debug(`no transactions found for addresses: ${addresses.join(', ')}`);
            }
            return txInfos;
        });
        this.seal = ({ key, link, addresses }) => __awaiter(this, void 0, void 0, function* () {
            const writer = this.getWriter(key);
            this.start();
            this.logger.debug(`sealing ${link}`);
            return yield writer.send({
                to: addresses.map(address => {
                    return {
                        address,
                        amount: this.getTxAmount()
                    };
                })
            });
        });
        this.sealPubKey = (opts) => {
            let { link, basePubKey } = opts;
            link = utils.linkToBuf(link);
            basePubKey = utils.toECKeyObj(basePubKey);
            return protocol.sealPubKey({ link, basePubKey });
        };
        this.sealPrevPubKey = (opts) => {
            let { link, basePubKey } = opts;
            link = utils.linkToBuf(link);
            basePubKey = utils.toECKeyObj(basePubKey);
            return protocol.sealPrevPubKey({ link, basePubKey });
        };
        this.sealAddress = (opts) => {
            const { link, basePubKey } = opts;
            const { pub } = this.sealPubKey({ link, basePubKey });
            return this.network.pubKeyToAddress(pub);
        };
        this.sealPrevAddress = (opts) => {
            const { link, basePubKey } = opts;
            const { pub } = this.sealPrevPubKey({ link, basePubKey });
            return this.network.pubKeyToAddress(pub);
        };
        this.start = () => this.startOrStop('start');
        this.stop = () => this.startOrStop('stop');
        this.getMyChainPub = () => this.tradle.provider.getMyChainKeyPub();
        this.getMyChainAddress = () => this.getMyChainPub()
            .then(({ fingerprint }) => fingerprint);
        this.recharge = (opts) => __awaiter(this, void 0, void 0, function* () {
            let { address, minBalance, force } = opts;
            if (!address) {
                address = yield this.getMyChainAddress();
            }
            if (!minBalance) {
                minBalance = this.minBalance;
            }
            const client = this.writers[address] || this.reader;
            return client.recharge({ address, minBalance, force });
        });
        this.balance = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            let { address } = opts;
            if (!address) {
                address = yield this.getMyChainAddress();
            }
            return this.addressesAPI.balance(address);
        });
        this.tradle = tradle;
        const { env, network } = tradle;
        Object.assign(this, network);
        const { flavor, networkName } = network;
        if (!adapters[flavor]) {
            throw new Error(`unsupported blockchain type: ${flavor}`);
        }
        this.reader = this.createAdapter();
        this.addressesAPI = promisify(this.reader.blockchain.addresses);
        this.getInfo = promisify(this.reader.blockchain.info);
        this.network = this.reader.network;
        this.logger = env.sublogger('blockchain');
    }
}
exports.default = Blockchain;
//# sourceMappingURL=blockchain.js.map