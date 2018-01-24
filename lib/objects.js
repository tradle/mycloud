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
const Embed = require("@tradle/embed");
const engine_1 = require("@tradle/engine");
const types = require("./typeforce-types");
const errors_1 = require("./errors");
const constants_1 = require("./constants");
const utils_1 = require("./utils");
const crypto_1 = require("./crypto");
const string_utils_1 = require("./string-utils");
class Objects {
    constructor(tradle) {
        this.validate = (object) => {
            try {
                crypto_1.extractSigPubKey(object);
            }
            catch (err) {
                throw new errors_1.InvalidSignature(`for ${object[constants_1.TYPE]}`);
            }
        };
        this.getMetadata = (object, forceRecalc) => {
            utils_1.typeforce(types.signedObject, object);
            if (this.env.TESTING) {
                this._ensureNoS3Urls(object);
            }
            const type = object[constants_1.TYPE];
            let _sigPubKey = forceRecalc ? null : object._sigPubKey;
            if (!_sigPubKey) {
                try {
                    _sigPubKey = crypto_1.extractSigPubKey(object).pub;
                }
                catch (err) {
                    this.logger.error('invalid object', {
                        object,
                        error: err.stack
                    });
                    throw new errors_1.InvalidSignature(`for ${type}`);
                }
            }
            const { link, permalink, prevlink } = crypto_1.getLinks(object);
            const ret = {
                _sigPubKey,
                _link: link,
                _permalink: permalink
            };
            if (prevlink)
                ret._prevlink = prevlink;
            return ret;
        };
        this.addMetadata = (object, forceRecalc) => {
            if (!forceRecalc && object._sigPubKey && object._link && object._permalink) {
                return object;
            }
            return utils_1.setVirtual(object, this.getMetadata(object));
        };
        this._replaceDataUrls = (object) => {
            return Embed.replaceDataUrls({
                region: this.region,
                bucket: this.fileUploadBucketName,
                keyPrefix: '',
                object
            });
        };
        this.replaceEmbeds = (object) => __awaiter(this, void 0, void 0, function* () {
            const replacements = this._replaceDataUrls(object);
            if (!replacements.length)
                return;
            this.logger.debug(`replaced ${replacements.length} embedded media`);
            yield Promise.all(replacements.map(replacement => {
                const { bucket, key, body, mimetype } = replacement;
                return this.s3Utils.put({
                    bucket,
                    key,
                    value: body,
                    headers: {
                        ContentType: mimetype
                    }
                });
            }));
        });
        this.resolveEmbed = (embed) => __awaiter(this, void 0, void 0, function* () {
            this.logger.debug(`resolving embedded media: ${embed.url}`);
            const { presigned, key, bucket } = embed;
            if (embed.presigned) {
                return yield utils_1.download(embed);
            }
            const { Body, ContentType } = yield this.s3Utils.get({ key, bucket });
            Body.mimetype = ContentType;
            return Body;
        });
        this.resolveEmbeds = (object) => __awaiter(this, void 0, void 0, function* () {
            return yield Embed.resolveEmbeds({ object, resolve: this.resolveEmbed });
        });
        this.get = (link) => __awaiter(this, void 0, void 0, function* () {
            utils_1.typeforce(utils_1.typeforce.String, link);
            this.logger.debug('getting', link);
            return yield this.bucket.getJSON(link);
        });
        this._ensureNoDataUrls = object => {
            const replacements = this._replaceDataUrls(_.cloneDeep(object));
            if (replacements.length) {
                throw new Error(`expected no data urls: ${string_utils_1.prettify(object)}`);
            }
        };
        this._ensureNoS3Urls = object => {
            const embeds = Embed.getEmbeds(object);
            if (embeds.length) {
                throw new Error(`expected raw embeds, instead have linked: ${string_utils_1.prettify(object)}`);
            }
        };
        this.put = (object) => __awaiter(this, void 0, void 0, function* () {
            utils_1.typeforce(types.signedObject, object);
            object = _.clone(object);
            utils_1.ensureTimestamped(object);
            this.addMetadata(object);
            if (this.env.TESTING) {
                this._ensureNoDataUrls(object);
            }
            this.logger.debug('putting', utils_1.summarizeObject(object));
            return yield this.bucket.putJSON(object._link, object);
        });
        this.prefetch = (link) => {
            this.get(link);
        };
        this.del = (link) => __awaiter(this, void 0, void 0, function* () {
            yield this.bucket.del(link);
        });
        this.presignEmbeddedMediaLinks = (opts) => {
            const { object, stripEmbedPrefix } = opts;
            Embed.presignUrls({
                object,
                sign: ({ bucket, key, path }) => {
                    this.logger.debug('pre-signing url for', {
                        type: object[constants_1.TYPE],
                        property: path
                    });
                    return this.s3Utils.createPresignedUrl({ bucket, key });
                }
            });
            if (stripEmbedPrefix) {
                Embed.stripEmbedPrefix(object);
            }
            return object;
        };
        this.validateNewVersion = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { identities } = this.tradle;
            const { object } = opts;
            const previous = yield this.get(object[constants_1.PREVLINK]);
            yield Promise.all([
                object._author ? utils_1.RESOLVED_PROMISE : identities.addAuthorInfo(object),
                previous._author ? utils_1.RESOLVED_PROMISE : identities.addAuthorInfo(previous)
            ]);
            if (object._author !== previous._author) {
                throw new errors_1.InvalidAuthor(`expected ${previous._author}, got ${object._author}`);
            }
            try {
                engine_1.protocol.validateVersioning({
                    object,
                    prev: previous,
                    orig: object[constants_1.PERMALINK]
                });
            }
            catch (err) {
                throw new errors_1.InvalidVersion(err.message);
            }
        });
        const { env, buckets, s3Utils, logger } = tradle;
        this.tradle = tradle;
        this.env = env;
        this.region = env.REGION;
        this.buckets = buckets;
        this.bucket = this.buckets.Objects;
        this.s3Utils = s3Utils;
        this.fileUploadBucketName = buckets.FileUpload.name;
        this.logger = logger.sub('objects');
    }
}
exports.default = Objects;
exports.Objects = Objects;
//# sourceMappingURL=objects.js.map