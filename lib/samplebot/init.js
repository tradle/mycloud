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
const constants_1 = require("@tradle/constants");
const buildResource = require("@tradle/build-resource");
const DEFAULT_CONF = require("./conf/provider");
const media_1 = require("./media");
const configure_1 = require("./configure");
const Errors = require("../errors");
const baseOrgObj = {
    [constants_1.TYPE]: 'tradle.Organization'
};
const getHandleFromName = (name) => {
    return name.replace(/[^A-Za-z]/g, '').toLowerCase();
};
class Init {
    constructor({ bot, tradle, conf = {} }) {
        this.ensureInitialized = () => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.bot.getMyIdentity();
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
                yield this.init();
            }
        });
        this.init = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { bot, priv } = this;
            bot.logger.info(`initializing provider ${priv.org.name}`);
            const identityInfo = yield bot.init(opts);
            const org = yield this.createOrg();
            yield Promise.all([
                this.savePrivateConf(),
                this.savePublicConf({ org, identity: identityInfo.pub })
            ]);
        });
        this.getPrivateConf = () => this.confManager.getPrivateConf();
        this.getPublicConf = () => this.confManager.getPublicConf();
        this.savePublicConf = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            const getOrg = opts.org
                ? Promise.resolve(opts.org)
                : this.getPublicConf().then(conf => conf.org);
            const getIdentity = opts.identity
                ? Promise.resolve(opts.identity)
                : this.bot.getMyIdentity();
            const [org, identity] = yield Promise.all([getOrg, getIdentity]);
            yield this.confManager.savePublicConf(this.createPublicConf({ org, identity }));
        });
        this.savePrivateConf = () => __awaiter(this, void 0, void 0, function* () {
            this.logger.debug(`saving private conf`);
            let current;
            try {
                current = yield this.getPrivateConf();
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
            }
            if (current) {
                yield this.updateOrg({ current: current.org });
            }
            yield this.confManager.savePrivateConf(this.priv);
        });
        this.updateOrg = ({ current }) => __awaiter(this, void 0, void 0, function* () {
            const update = this.priv.org;
            if (update.domain !== current.domain) {
                throw new Error('cannot change org "domain" at this time');
            }
            if (update.name !== current.name) {
                throw new Error('cannot change org "domain" at this time');
            }
            if (update.logo && update.logo !== current.logo) {
                throw new Error('cannot change org "logo" at this time');
            }
        });
        this.createOrg = () => __awaiter(this, void 0, void 0, function* () {
            const { bot, priv } = this;
            let { name, domain, logo } = priv.org;
            if (!(name && domain)) {
                throw new Error('org "name" and "domain" are required');
            }
            if (!(logo && /^data:/.test(logo))) {
                const ImageUtils = require('./image-utils');
                try {
                    logo = yield ImageUtils.getLogo({ logo, domain });
                }
                catch (err) {
                    this.logger.debug(`unable to load logo for domain: ${domain}`);
                    logo = media_1.LOGO_UNKNOWN;
                }
            }
            priv.logo = logo;
            return yield bot.signAndSave(this.getOrgObj({ name, logo }));
        });
        this.update = () => __awaiter(this, void 0, void 0, function* () {
            yield Promise.all([
                this.savePublicConf(),
                this.savePrivateConf()
            ]);
        });
        this.getOrgObj = ({ name, logo }) => (Object.assign({}, baseOrgObj, { name, photos: [
                {
                    url: logo
                }
            ] }));
        this.createPublicConf = ({ style, org, identity }) => ({
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
            publicConfig: this.pub.publicConfig,
            style: this.pub.style
        });
        this.bot = bot;
        this.logger = bot.logger;
        this.confManager = configure_1.createConf({ tradle });
        this.pub = Object.assign({}, DEFAULT_CONF.public, (conf.public || {}));
        this.priv = Object.assign({}, DEFAULT_CONF.private, (conf.private || {}));
    }
}
exports.default = Init;
//# sourceMappingURL=init.js.map