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
const debug = require("debug")("tradle:sls:friends");
const Cache = require("lru-cache");
const constants_1 = require("@tradle/constants");
const buildResource = require("@tradle/build-resource");
const crypto_1 = require("./crypto");
const utils_1 = require("./utils");
const FRIEND_TYPE = "tradle.MyCloudFriend";
const TEN_MINUTES = 10 * 60 * 60000;
const createCache = () => new Cache({ max: 100, maxAge: TEN_MINUTES });
class Friends {
    constructor(tradle) {
        this.load = (opts) => __awaiter(this, void 0, void 0, function* () {
            let { url } = opts;
            url = url.replace(/[/]+$/, "");
            const infoUrl = getInfoEndpoint(url);
            const info = yield utils_1.get(infoUrl);
            const { bot: { pub }, org, publicConfig } = info;
            const { name } = org;
            yield this.add({
                name,
                url,
                org,
                publicConfig,
                identity: pub
            });
        });
        this.add = (props) => __awaiter(this, void 0, void 0, function* () {
            const { models, model } = this;
            const { name, identity } = props;
            crypto_1.addLinks(identity);
            let existing;
            try {
                existing = yield this.getByIdentityPermalink(identity._permalink);
            }
            catch (err) {
                existing = {};
            }
            const object = buildResource({ models, model })
                .set(Object.assign({}, utils_1.pick(existing, Object.keys(model.properties)), props, { _identityPermalink: identity._permalink }))
                .toJSON();
            if (Object.keys(existing).length) {
                object[constants_1.PREVLINK] = buildResource.link(existing);
                object[constants_1.PERMALINK] = buildResource.permalink(existing);
            }
            const myIdentity = yield this.provider.getMyPublicIdentity();
            if (myIdentity._permalink === identity._permalink ||
                myIdentity._link === identity._link) {
                throw new Error('refusing to add self as friend');
            }
            const promiseAddContact = this.identities.addContact(identity);
            const signed = yield this.provider.signObject({ object });
            const permalink = buildResource.permalink(identity);
            buildResource.setVirtual(signed, {
                _time: Date.now(),
                _identityPermalink: permalink
            });
            yield promiseAddContact;
            debug(`saving friend: ${name}`);
            yield this.db.update(signed);
            this.cache.set(identity._permalink, signed);
            return signed;
        });
        this.getByIdentityPermalink = (permalink) => __awaiter(this, void 0, void 0, function* () {
            const cached = this.cache.get(permalink);
            if (cached)
                return cached;
            const friend = yield this.db.get({
                [constants_1.TYPE]: FRIEND_TYPE,
                _identityPermalink: permalink
            });
            this.cache.set(permalink, friend);
            return friend;
        });
        this.list = (opts) => {
            const { permalink } = opts;
            return this.db.find({
                filter: {
                    EQ: {
                        [constants_1.TYPE]: FRIEND_TYPE
                    }
                }
            });
        };
        const { models, db, identities, provider } = tradle;
        this.models = models;
        this.model = models[FRIEND_TYPE];
        this.db = db;
        this.identities = identities;
        this.provider = provider;
        this.cache = createCache();
    }
}
exports.default = Friends;
function getInfoEndpoint(url) {
    if (!url.endsWith("/info")) {
        url += "/info";
    }
    return url;
}
//# sourceMappingURL=friends.js.map