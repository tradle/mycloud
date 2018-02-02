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
const QS = require("querystring");
const _ = require("lodash");
const seals_1 = require("./seals");
const utils_1 = require("./utils");
const PLACEHOLDER = '<n/a>';
const noop = () => { };
const promiseNoop = () => __awaiter(this, void 0, void 0, function* () { });
const identityFn = val => val;
const emptyPubShim = () => ({ pub: PLACEHOLDER });
const emptyAddressShim = pub => PLACEHOLDER;
const getEndpointFromEnv = (env) => {
    const { CORDA_API_URL, CORDA_API_KEY } = env;
    if (CORDA_API_URL) {
        return {
            apiUrl: CORDA_API_URL,
            apiKey: CORDA_API_KEY
        };
    }
};
class CordaRestClient {
    constructor(endpoint) {
        this.seal = ({ link, counterparty }) => __awaiter(this, void 0, void 0, function* () {
            return yield this.post(`${this.endpoint.apiUrl}/item`, {
                link,
                partyTmpId: counterparty
            });
        });
        this.setEndpoint = (endpoint) => {
            this.endpoint = endpoint;
        };
        this.post = (url, data) => __awaiter(this, void 0, void 0, function* () {
            if (!(this.endpoint && this.endpoint.apiUrl)) {
                throw new Error(`don't know Corda REST endpoint, use setEndpoint to set`);
            }
            const res = yield utils_1.fetch(url, {
                method: 'POST',
                body: QS.stringify(data),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    Authorization: this.endpoint.apiKey
                }
            });
            return yield utils_1.processResponse(res);
        });
        this.endpoint = endpoint;
    }
}
exports.CordaRestClient = CordaRestClient;
class Blockchain {
    constructor(opts) {
        this.start = noop;
        this.wrapOperation = identityFn;
        this.sealPubKey = emptyPubShim;
        this.sealPrevPubKey = emptyPubShim;
        this.pubKeyToAddress = emptyAddressShim;
        this.seal = (opts) => __awaiter(this, void 0, void 0, function* () {
            return yield this.client.seal(opts);
        });
        this.setEndpoint = opts => this.client.setEndpoint(opts);
        const { env, endpoint, network } = opts;
        this.client = new CordaRestClient(endpoint || getEndpointFromEnv(env));
        _.extend(this, _.pick(network, ['flavor', 'networkName', 'minBalance']));
    }
}
exports.Blockchain = Blockchain;
class CordaSeals {
    constructor(tradle) {
        this.create = opts => this.seals.create(opts);
        this.sealPending = (opts = {}) => {
            return this.seals.sealPending(Object.assign({}, opts, { key: {
                    priv: PLACEHOLDER,
                    pub: PLACEHOLDER
                } }));
        };
        this.watch = promiseNoop;
        this.watchNextVersion = promiseNoop;
        this.syncUnconfirmed = opts => promiseNoop;
        this.getUnconfirmed = opts => this.seals.getUnconfirmed(opts);
        this.getLongUnconfirmed = opts => this.seals.getLongUnconfirmed(opts);
        this.getUnsealed = opts => this.seals.getUnsealed(opts);
        this.get = opts => this.seals.get(opts);
        this.handleFailures = promiseNoop;
        this.getFailedReads = () => __awaiter(this, void 0, void 0, function* () { return []; });
        this.getFailedWrites = () => __awaiter(this, void 0, void 0, function* () { return []; });
        this.requeueFailedWrites = promiseNoop;
        this.setEndpoint = opts => this.blockchain.setEndpoint(opts);
        let seals;
        Object.defineProperty(this, 'seals', {
            get() {
                if (!seals)
                    seals = new seals_1.Seals(tradle);
                return seals;
            }
        });
        this.blockchain = tradle.blockchain;
    }
}
exports.Seals = CordaSeals;
//# sourceMappingURL=corda-seals.js.map