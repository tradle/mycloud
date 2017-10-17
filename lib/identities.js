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
const Debug = require("debug");
const constants = require("./constants");
const Errors = require("./errors");
const utils_1 = require("./utils");
const crypto_1 = require("./crypto");
const types = require("./typeforce-types");
const debug = Debug('tradle:sls:identities');
const { PREVLINK, TYPE, TYPES } = constants;
const { MESSAGE } = TYPES;
const { NotFound } = Errors;
class Identities {
    constructor(opts) {
        this.getIdentityMetadataByPub = (pub) => {
            debug('get identity metadata by pub');
            return this.pubKeys.get({
                Key: { pub },
                ConsistentRead: true
            });
        };
        this.getIdentityByPub = (pub) => __awaiter(this, void 0, void 0, function* () {
            const { link } = yield this.getIdentityMetadataByPub(pub);
            try {
                return yield this.objects.get(link);
            }
            catch (err) {
                debug('unknown identity', pub, err);
                throw new NotFound('identity with pub: ' + pub);
            }
        });
        this.getIdentityByPermalink = (permalink) => __awaiter(this, void 0, void 0, function* () {
            const params = {
                IndexName: 'permalink',
                KeyConditionExpression: 'permalink = :permalinkValue',
                ExpressionAttributeValues: {
                    ":permalinkValue": permalink
                }
            };
            debug('get identity by permalink');
            const { link } = yield this.pubKeys.findOne(params);
            try {
                return yield this.objects.get(link);
            }
            catch (err) {
                debug('unknown identity', permalink, err);
                throw new NotFound('identity with permalink: ' + permalink);
            }
        });
        this.getExistingIdentityMapping = (identity) => {
            debug('checking existing mappings for pub keys');
            const lookups = identity.pubkeys.map(obj => this.getIdentityMetadataByPub(obj.pub));
            return utils_1.firstSuccess(lookups);
        };
        this.validateNewContact = (identity) => __awaiter(this, void 0, void 0, function* () {
            identity = utils_1.omitVirtual(identity);
            let existing;
            try {
                existing = yield this.getExistingIdentityMapping(identity);
            }
            catch (err) { }
            const { link, permalink } = crypto_1.addLinks(identity);
            if (existing) {
                if (existing.link === link) {
                    debug(`mapping is already up to date for identity ${permalink}`);
                }
                else if (identity[PREVLINK] !== existing.link) {
                    debug('identity mapping collision. Refusing to add contact:', JSON.stringify(identity));
                    throw new Error(`refusing to add identity with link: "${link}"`);
                }
            }
            return {
                identity: existing || identity,
                exists: !!existing
            };
        });
        this.addContact = (object) => __awaiter(this, void 0, void 0, function* () {
            if (object) {
                utils_1.typeforce(types.identity, object);
            }
            else {
                object = yield this.objects.get(crypto_1.getLink(object));
            }
            const { link, permalink } = crypto_1.addLinks(object);
            const putPubKeys = object.pubkeys
                .map(props => this.putPubKey(Object.assign({}, props, { link, permalink })));
            debug(`adding contact ${permalink}`);
            yield Promise.all(putPubKeys.concat(this.objects.put(object)));
            debug(`added contact ${permalink}`);
        });
        this.putPubKey = (props) => {
            const { pub, link } = props;
            debug(`adding mapping from pubKey "${pub}" to link "${link}"`);
            return this.pubKeys.put({
                Item: props
            });
        };
        this.addAuthorInfo = (object) => __awaiter(this, void 0, void 0, function* () {
            if (!object._sigPubKey) {
                this.objects.addMetadata(object);
            }
            const type = object[TYPE];
            const isMessage = type === MESSAGE;
            const pub = isMessage && object.recipientPubKey.pub.toString('hex');
            const { author, recipient } = {
                author: yield this.getIdentityMetadataByPub(object._sigPubKey),
                recipient: yield (pub ? this.getIdentityMetadataByPub(pub) : utils_1.RESOLVED_PROMISE)
            };
            utils_1.setVirtual(object, { _author: author.permalink });
            if (recipient) {
                utils_1.setVirtual(object, { _recipient: recipient.permalink });
            }
            return object;
        });
        this.validateAndAdd = (identity) => __awaiter(this, void 0, void 0, function* () {
            const result = yield this.validateNewContact(identity);
            if (!result.exists) {
                yield this.addContact(result.identity);
            }
        });
        utils_1.logify(this);
        utils_1.bindAll(this);
        const { tables, objects } = opts;
        this.objects = objects;
        this.pubKeys = tables.PubKeys;
    }
}
exports.default = Identities;
//# sourceMappingURL=identities.js.map