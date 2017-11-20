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
const constants_2 = require("./constants");
const DEFAULT_CONF = require("./default-conf");
const media_1 = require("./media");
const conf_1 = require("./conf");
const Errors = require("../errors");
const baseOrgObj = {
    [constants_1.TYPE]: 'tradle.Organization'
};
const getHandleFromName = (name) => {
    return name.replace(/[^A-Za-z]/g, '').toLowerCase();
};
class Init {
    constructor({ bot, tradle, conf }) {
        this.ensureInitialized = () => __awaiter(this, void 0, void 0, function* () {
            try {
                yield bot.getMyIdentity();
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
                yield this.init();
            }
        });
        this.init = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { bot, conf } = this;
            bot.logger.info(`initializing provider ${conf.org.name}`);
            const { pub, priv } = yield bot.init(opts);
            const org = yield this.createOrg();
            yield Promise.all([
                this.savePrivateConf(),
                this.savePublicConf({ org, identity: pub })
            ]);
        });
        this.savePublicConf = (opts = {}) => __awaiter(this, void 0, void 0, function* () {
            const getOrg = opts.org
                ? Promise.resolve(opts.org)
                : this.publicConf.get().then(conf => conf.org);
            const getIdentity = opts.identity
                ? Promise.resolve(opts.identity)
                : this.bot.getMyIdentity();
            const [org, identity] = yield Promise.all([getOrg, getIdentity]);
            yield this.confManager.savePublicConf(this.createPublicConf({ org, identity }));
        });
        this.savePrivateConf = () => __awaiter(this, void 0, void 0, function* () {
            this.bot.logger.debug(`saving private conf`);
            yield this.confManager.savePrivateConf(this.createPrivateConf(this.conf));
        });
        this.createOrg = () => __awaiter(this, void 0, void 0, function* () {
            const { bot, conf } = this;
            let { name, domain, logo } = conf.org;
            if (!(name && domain)) {
                throw new Error('org "name" and "domain" are required');
            }
            if (!(logo && /^data:/.test(logo))) {
                const ImageUtils = require('./image-utils');
                try {
                    logo = yield ImageUtils.getLogo({ logo, domain });
                }
                catch (err) {
                    debug(`unable to load logo for domain: ${domain}`);
                    logo = media_1.LOGO_UNKNOWN;
                }
            }
            return yield bot.signAndSave(this.getOrgObj({ name, logo }));
        });
        this.update = () => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.privateConf.get(constants_2.PRIVATE_CONF_KEY);
            }
            catch (err) {
                yield this.savePrivateConf();
            }
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
            publicConfig: this.conf.publicConfig,
            style: this.conf.style
        });
        this.createPrivateConf = (conf) => conf;
        this.bot = bot;
        this.confManager = conf_1.createConf({ tradle });
        this.conf = Object.assign({}, DEFAULT_CONF, conf);
    }
}
exports.default = Init;
//# sourceMappingURL=init.js.map