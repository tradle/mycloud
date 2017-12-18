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
const dotProp = require("dot-prop");
const deepEqual = require("deep-equal");
const constants_1 = require("@tradle/constants");
const validateResource = require("@tradle/validate-resource");
const buildResource = require("@tradle/build-resource");
const serverlessYml = require("../cli/serverless-yml");
const Errors = require("../errors");
const utils_1 = require("../utils");
const cacheable_bucket_item_1 = require("../cacheable-bucket-item");
const DEFAULT_CONF = require("./conf/provider");
const media_1 = require("./media");
const { reinitializeOnConfChanged } = serverlessYml.custom;
const parseJSON = JSON.parse.bind(JSON);
const getHandleFromName = (name) => {
    return name.replace(/[^A-Za-z]/g, '').toLowerCase();
};
const baseOrgObj = {
    [constants_1.TYPE]: 'tradle.Organization'
};
const baseStylePackObj = {
    [constants_1.TYPE]: 'tradle.StylesPack'
};
exports.BOT_CONF_KEY = 'conf/bot.json';
exports.MODELS_KEY = 'conf/models.json';
exports.LENSES_KEY = 'conf/lenses.json';
exports.STYLE_KEY = 'conf/style.json';
exports.ORG_KEY = 'org/org.json';
exports.INFO_KEY = 'info/info.json';
const parts = {
    org: {
        bucket: 'PrivateConf',
        key: exports.ORG_KEY
    },
    style: {
        bucket: 'PrivateConf',
        key: exports.STYLE_KEY
    },
    info: {
        bucket: 'PrivateConf',
        key: exports.INFO_KEY
    },
    botConf: {
        bucket: 'PrivateConf',
        key: exports.BOT_CONF_KEY
    },
    models: {
        bucket: 'PrivateConf',
        key: exports.MODELS_KEY
    },
    lenses: {
        bucket: 'PrivateConf',
        key: exports.LENSES_KEY
    }
};
class Conf {
    constructor({ bot, logger }) {
        this.get = () => __awaiter(this, void 0, void 0, function* () {
            const promises = {};
            Object.keys(parts).forEach(key => {
                promises[key] = this[key].get().catch(err => null);
            });
            return yield Promise.props(promises);
        });
        this.saveBotConf = (value, reinitializeContainers = true) => __awaiter(this, void 0, void 0, function* () {
            yield this.botConf.put(value);
            if (reinitializeContainers) {
                yield this.forceReinitializeContainers();
            }
        });
        this.forceReinitializeContainers = () => __awaiter(this, void 0, void 0, function* () {
            return yield this.bot.forceReinitializeContainers(reinitializeOnConfChanged);
        });
        this.setStyle = (style, reinitializeContainers = true) => __awaiter(this, void 0, void 0, function* () {
            yield this.bot.promiseReady();
            validateResource({
                models: this.bot.models,
                model: 'tradle.StylesPack',
                resource: style
            });
            yield this.savePublicInfo({ style });
        });
        this.savePublicInfo = ({ identity, org, style } = {}) => __awaiter(this, void 0, void 0, function* () {
            const getIdentity = identity ? Promise.resolve(identity) : this.bot.getMyIdentity();
            const getOrg = org ? Promise.resolve(org) : this.org.get();
            const getStyle = style ? Promise.resolve(style) : this.style.get();
            const info = this.calcPublicInfo({
                identity: yield getIdentity,
                org: yield getOrg,
                style: yield getStyle
            });
            yield this.info.put(info);
        });
        this.calcPublicInfo = ({ identity, org, style }) => {
            return {
                bot: {
                    profile: {
                        name: {
                            firstName: `${org.name} Bot`
                        }
                    },
                    pub: buildResource.omitVirtual(identity)
                },
                id: getHandleFromName(org.name),
                org: buildResource.omitVirtual(org),
                style
            };
        };
        this.init = (conf, opts = {}) => __awaiter(this, void 0, void 0, function* () {
            conf = Object.assign({}, DEFAULT_CONF, conf);
            const { bot } = this;
            if (bot.isTesting) {
                const { org } = conf;
                org.domain += '.local';
                org.name += '-local';
            }
            const orgTemplate = conf.org;
            this.logger.info(`initializing provider ${orgTemplate.name}`);
            let identity;
            try {
                const identityInfo = yield bot.init({
                    force: opts.forceRecreateIdentity
                });
                identity = identityInfo.pub;
            }
            catch (err) {
                Errors.ignore(err, Errors.Exists);
                identity = yield bot.getMyIdentity();
            }
            const logo = yield this.getLogo(conf);
            if (!orgTemplate.logo) {
                orgTemplate.logo = logo;
            }
            let { style } = conf;
            if (!style) {
                style = conf.style = Object.assign({}, baseStylePackObj);
            }
            if (!style.logo) {
                style.logo = {
                    url: logo
                };
            }
            const org = yield bot.signAndSave(buildOrg(orgTemplate));
            yield this.save({ identity, org, bot: conf.bot, style });
        });
        this.update = (conf) => __awaiter(this, void 0, void 0, function* () {
            yield this.save({
                bot: conf.bot,
                style: conf.style
            });
            if (conf.bot) {
                yield this.forceReinitializeContainers();
            }
        });
        this.save = ({ identity, org, style, bot }) => __awaiter(this, void 0, void 0, function* () {
            yield Promise.all([
                style ? this.style.put(style) : utils_1.RESOLVED_PROMISE,
                org ? this.org.put(org) : utils_1.RESOLVED_PROMISE,
                bot ? this.botConf.put(bot) : utils_1.RESOLVED_PROMISE,
                (identity || style || org)
                    ? this.savePublicInfo({ identity, style, org })
                    : utils_1.RESOLVED_PROMISE
            ]);
        });
        this.recalcPublicInfo = () => __awaiter(this, void 0, void 0, function* () {
            const [identity, org, style] = yield Promise.all([
                this.bot.getMyIdentity(),
                this.org.get(),
                this.style.get()
            ]);
            yield this.savePublicInfo({ identity, org, style });
        });
        this.getLogo = (conf) => __awaiter(this, void 0, void 0, function* () {
            const defaultLogo = dotProp.get(conf, 'style.logo.url');
            let { name, domain, logo = defaultLogo } = conf.org;
            if (!(name && domain)) {
                throw new Error('org "name" and "domain" are required');
            }
            if (!(logo && /^data:/.test(logo))) {
                const ImageUtils = require('./image-utils');
                try {
                    return yield ImageUtils.getLogo({ logo, domain });
                }
                catch (err) {
                    this.logger.debug(`unable to load logo for domain: ${domain}`);
                    return media_1.LOGO_UNKNOWN;
                }
            }
            return logo;
        });
        this.bot = bot;
        this.logger = logger || bot.logger;
        const { buckets } = bot;
        this.privateConfBucket = buckets.PrivateConf;
        for (let name in parts) {
            let part = parts[name];
            this[name] = new cacheable_bucket_item_1.CacheableBucketItem({
                bucket: buckets[part.bucket],
                key: part.key,
                ttl: part.ttl,
                parse: part.parse || parseJSON
            });
        }
    }
}
exports.Conf = Conf;
exports.createConf = (opts) => new Conf(opts);
const hasDifferentValue = ({ bucket, key, value }) => __awaiter(this, void 0, void 0, function* () {
    try {
        const current = yield bucket.get(key);
        return !deepEqual(current, value);
    }
    catch (err) {
        Errors.ignore(err, Errors.NotFound);
        return true;
    }
});
const buildOrg = ({ name, domain, logo }) => (Object.assign({}, baseOrgObj, { name,
    domain, photos: [
        {
            url: logo
        }
    ] }));
const validateOrgUpdate = ({ current, update }) => {
    if (update.domain !== current.domain) {
        throw new Error('cannot change org "domain" at this time');
    }
    if (update.name !== current.name) {
        throw new Error('cannot change org "domain" at this time');
    }
    if (update.logo && update.logo !== current.logo) {
        throw new Error('cannot change org "logo" at this time');
    }
};
//# sourceMappingURL=configure.js.map