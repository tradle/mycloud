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
const Promise = require("bluebird");
const crypto = require("crypto");
const QR = require("@tradle/qr-schema");
const remediation_1 = require("./plugins/remediation");
const Errors = require("../errors");
const content_addressed_store_1 = require("../content-addressed-store");
const NONCE_LENGTH = 16;
const CLAIM_ID_ENCODING = 'hex';
class Remediator {
    constructor({ bot, productsAPI, logger }) {
        this.handleMessages = () => {
            if (!this._removeHandler) {
                this._removeHandler = this.productsAPI.use(this.plugin);
            }
        };
        this.stopHandlingMessages = () => {
            const { _removeHandler } = this;
            if (_removeHandler) {
                this._removeHandler = null;
                _removeHandler();
            }
        };
        this.saveUnsignedDataBundle = (bundle) => __awaiter(this, void 0, void 0, function* () {
            this.remediation.validateBundle(bundle);
            return yield this.store.put(bundle);
        });
        this.createClaim = ({ key }) => __awaiter(this, void 0, void 0, function* () {
            const claimStub = yield this.genClaimStub({ key });
            const { nonce, claimId } = claimStub;
            const nonces = yield this.getNonces({ key });
            nonces.push(nonce);
            yield this.conf.put(key, nonces);
            return claimStub;
        });
        this.deleteClaimsForBundle = ({ key, claimId }) => __awaiter(this, void 0, void 0, function* () {
            if (!key)
                key = exports.parseClaimId(claimId).key;
            yield Promise.all([
                this.conf.del(key),
                this.store.del(key)
            ]);
        });
        this.onClaimRedeemed = ({ user, claimId }) => __awaiter(this, void 0, void 0, function* () {
            this.logger.debug(`claim processed, deleting claim stubs`, { claimId, user: user.id });
            yield this.deleteClaimsForBundle({ claimId });
        });
        this.getBundle = ({ key, claimId }) => __awaiter(this, void 0, void 0, function* () {
            if (!key)
                key = exports.parseClaimId(claimId).key;
            return this.getBundleByKey({ key });
        });
        this.getBundleByKey = ({ key }) => __awaiter(this, void 0, void 0, function* () {
            return yield this.store.getJSON(key);
        });
        this.getBundleByClaimId = ({ claimId }) => __awaiter(this, void 0, void 0, function* () {
            const { nonce, key } = exports.parseClaimId(claimId);
            const nonces = yield this.getNonces({ key });
            if (nonces.includes(nonce)) {
                return yield this.getBundleByKey({ key });
            }
            throw new Errors.NotFound('claim not found');
        });
        this.listClaimsForBundle = ({ key }) => __awaiter(this, void 0, void 0, function* () {
            const nonces = yield this.getNonces({ key });
            return yield Promise.all(nonces.map(nonce => this.toClaimStub({ key, nonce })));
        });
        this.genClaimStub = ({ key, bundle }) => __awaiter(this, void 0, void 0, function* () {
            try {
                if (!bundle)
                    yield this.getBundle({ key });
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
                throw new Errors.NotFound(`bundle not found with key: ${key}`);
            }
            if (!key)
                key = this.store.getKey(bundle);
            const nonce = crypto.randomBytes(NONCE_LENGTH);
            return this.toClaimStub({ key, nonce });
        });
        this.toClaimStub = ({ key, nonce }) => __awaiter(this, void 0, void 0, function* () {
            const claimId = Buffer.concat([
                typeof nonce === 'string' ? new Buffer(nonce, 'hex') : nonce,
                new Buffer(key, 'hex')
            ])
                .toString(CLAIM_ID_ENCODING);
            const provider = yield this.bot.getMyIdentityPermalink();
            debugger;
            const qrData = QR.toHex({
                schema: 'ImportData',
                data: {
                    host: this.bot.apiBaseUrl,
                    provider,
                    dataHash: claimId
                }
            });
            return {
                key,
                nonce: typeof nonce === 'string' ? nonce : nonce.toString('hex'),
                claimId,
                qrData
            };
        });
        this.getNonces = ({ key }) => __awaiter(this, void 0, void 0, function* () {
            try {
                return yield this.conf.get(key);
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
                return [];
            }
        });
        this.bot = bot;
        this.productsAPI = productsAPI;
        this.logger = logger;
        this.conf = bot.conf.sub('remediation:');
        this.store = new content_addressed_store_1.ContentAddressedStore({
            bucket: bot.buckets.PrivateConf.folder('remediation'),
        });
        this.remediation = new remediation_1.Remediation({
            bot,
            productsAPI,
            logger,
            getBundleByClaimId: claimId => this.getBundleByClaimId({ claimId }),
            onClaimRedeemed: this.onClaimRedeemed.bind(this)
        });
        this.plugin = remediation_1.createPlugin(this);
    }
}
exports.Remediator = Remediator;
exports.createRemediator = (opts) => new Remediator(opts);
exports.createPlugin = opts => new Remediator(opts).plugin;
exports.parseClaimId = (claimId) => {
    const hex = new Buffer(claimId, CLAIM_ID_ENCODING).toString('hex');
    return {
        nonce: hex.slice(0, NONCE_LENGTH * 2),
        key: hex.slice(NONCE_LENGTH * 2)
    };
};
//# sourceMappingURL=remediation.js.map