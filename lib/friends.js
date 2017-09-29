"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const debug = require("debug")("tradle:sls:friends");
const fetch = require("node-fetch");
const buildResource = require("@tradle/build-resource");
const crypto_1 = require("./crypto");
const FRIEND_TYPE = "tradle.MyCloudFriend";
class Friends {
    constructor(opts) {
        this.load = (opts) => __awaiter(this, void 0, void 0, function* () {
            let { url } = opts;
            url = url.replace(/[/]+$/, "");
            const infoUrl = getInfoEndpoint(url);
            const res = yield fetch(infoUrl);
            if (res.status > 300) {
                throw new Error(res.statusText);
            }
            const info = yield res.json();
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
            const object = buildResource({ models, model })
                .set(props)
                .toJSON();
            const promiseAddContact = this.identities.addContact(identity);
            const signed = yield this.provider.signObject({ object });
            const permalink = buildResource.permalink(identity);
            buildResource.setVirtual(signed, {
                _time: Date.now(),
                _identityPermalink: permalink
            });
            const saveFriend = this.db.merge(signed);
            debug(`saving friend: ${name}`);
            yield Promise.all([promiseAddContact, saveFriend]);
            return signed;
        });
        this.get = (opts) => {
            const { permalink } = opts;
            return this.db.findOne({
                type: FRIEND_TYPE,
                filter: {
                    EQ: {
                        _identityPermalink: permalink
                    }
                }
            });
        };
        this.list = (opts) => {
            const { permalink } = opts;
            return this.db.find({
                type: FRIEND_TYPE,
                orderBy: {
                    property: "_time",
                    desc: true
                }
            });
        };
        const { models, db, identities, provider } = opts;
        this.models = models;
        this.model = models[FRIEND_TYPE];
        this.db = db;
        this.identities = identities;
        this.provider = provider;
    }
}
function getInfoEndpoint(url) {
    if (!url.endsWith("/info")) {
        url += "/info";
    }
    return url;
}
module.exports = Friends;
//# sourceMappingURL=friends.js.map