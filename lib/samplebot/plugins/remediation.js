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
const createError = require("error-ex");
const constants_1 = require("@tradle/constants");
const validateResource = require("@tradle/validate-resource");
const buildResource = require("@tradle/build-resource");
const constants_2 = require("../constants");
const Errors = require("../../errors");
const { DATA_CLAIM, DATA_BUNDLE, VERIFICATION, FORM, MY_PRODUCT } = constants_2.TYPES;
const notNull = val => !!val;
const DEFAULT_CLAIM_NOT_FOUND_MESSAGE = 'Claim not found';
const DEFAULT_BUNDLE_MESSAGE = 'Please see your data and verifications';
const CustomErrors = {
    ClaimNotFound: createError('ClaimNotFound'),
    InvalidBundleItem: createError('InvalidBundleItem'),
    InvalidBundlePointer: createError('InvalidBundlePointer')
};
exports.Errors = CustomErrors;
class Remediation {
    constructor({ bot, productsAPI, logger, getBundleByClaimId, onClaimRedeemed }) {
        this.handleDataClaim = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { req, user, claim } = opts;
            try {
                yield this.sendDataBundleForClaim(opts);
            }
            catch (err) {
                Errors.ignore(err, CustomErrors.ClaimNotFound);
                yield this.productsAPI.sendSimpleMessage({
                    req,
                    to: user,
                    message: DEFAULT_CLAIM_NOT_FOUND_MESSAGE
                });
                return;
            }
            const { claimId } = claim;
            yield this.onClaimRedeemed({ claimId, user });
        });
        this.sendDataBundleForClaim = ({ req, user, claim, message = DEFAULT_BUNDLE_MESSAGE }) => __awaiter(this, void 0, void 0, function* () {
            const { claimId } = claim;
            let unsigned;
            try {
                unsigned = yield this.getBundleByClaimId(claimId);
            }
            catch (err) {
                throw new CustomErrors.ClaimNotFound(claimId);
            }
            const bundle = yield this.prepareDataBundle({ user, claimId, items: unsigned.items });
            yield bundle.items.map(item => this.bot.save(item));
            yield this.productsAPI.send({
                req,
                to: user,
                object: bundle
            });
            return bundle;
        });
        this.prepareDataBundle = ({ user, items, claimId }) => __awaiter(this, void 0, void 0, function* () {
            this.logger.debug(`creating data bundle`);
            const { bot, models } = this;
            const owner = user.id;
            items.forEach((item, i) => {
                const model = models[item[constants_1.TYPE]];
                if (!model) {
                    throw new CustomErrors.InvalidBundleItem(`missing model for item at index: ${i}`);
                }
                if (model.id !== VERIFICATION &&
                    model.subClassOf !== FORM &&
                    model.subClassOf !== MY_PRODUCT) {
                    throw new CustomErrors.InvalidBundleItem(`invalid item at index ${i}, expected form, verification or MyProduct`);
                }
            });
            items = items.map(item => _.clone(item));
            items = yield Promise.all(items.map((item) => __awaiter(this, void 0, void 0, function* () {
                if (models[item[constants_1.TYPE]].subClassOf === FORM) {
                    item[constants_1.OWNER] = owner;
                    return yield bot.sign(item);
                }
                return item;
            })));
            items = yield Promise.all(items.map((item) => __awaiter(this, void 0, void 0, function* () {
                if (item[constants_1.TYPE] === VERIFICATION) {
                    item = this.resolvePointers({ items, item });
                    return yield bot.sign(item);
                }
                return item;
            })));
            items = yield Promise.all(items.map((item) => __awaiter(this, void 0, void 0, function* () {
                if (models[item[constants_1.TYPE]].subClassOf === MY_PRODUCT) {
                    item = this.resolvePointers({ items, item });
                    return yield bot.sign(item);
                }
                return item;
            })));
            const unsigned = buildResource({
                models,
                model: DATA_BUNDLE
            })
                .set({ items })
                .toJSON();
            return yield this.bot.sign(unsigned);
        });
        this.validateBundle = (bundle) => {
            const { models } = this;
            let items = bundle.items.map(item => _.extend({
                [constants_1.SIG]: 'sigplaceholder'
            }, item));
            items = items.map(item => this.resolvePointers({ items, item }));
            items.forEach(resource => validateResource({ models, resource }));
        };
        this.resolvePointers = ({ items, item }) => {
            const { models } = this;
            const model = models[item[constants_1.TYPE]];
            item = _.clone(item);
            if (model.id === VERIFICATION) {
                if (item.document == null) {
                    throw new CustomErrors.InvalidBundlePointer('expected verification.document to point to a form or index in bundle');
                }
                item.document = this.getFormStub({ items, ref: item.document });
                if (item.sources) {
                    item.sources = item.sources.map(source => this.resolvePointers({ items, item: source }));
                }
            }
            else if (model.subClassOf === MY_PRODUCT) {
                if (item.forms) {
                    item.forms = item.forms.map(ref => this.getFormStub({ items, ref }));
                }
            }
            return item;
        };
        this.getFormStub = ({ items, ref }) => {
            const { models } = this;
            if (buildResource.isProbablyResourceStub(ref))
                return ref;
            const resource = items[ref];
            if (!(resource && models[resource[constants_1.TYPE]].subClassOf === FORM)) {
                throw new CustomErrors.InvalidBundlePointer(`expected form at index: ${ref}`);
            }
            return buildResource.stub({ models, resource });
        };
        this.bot = bot;
        this.models = bot.models;
        this.productsAPI = productsAPI;
        this.logger = logger;
        this.getBundleByClaimId = getBundleByClaimId;
        this.onClaimRedeemed = onClaimRedeemed;
    }
}
exports.Remediation = Remediation;
exports.createPlugin = (opts) => {
    const remediation = opts.remediation || new Remediation(opts);
    return {
        [`onmessage:${DATA_CLAIM}`]: req => {
            const { user, payload } = req;
            return remediation.handleDataClaim({ req, user, claim: payload });
        }
    };
};
//# sourceMappingURL=remediation.js.map