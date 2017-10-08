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
const debug_1 = require("debug");
const debug = debug_1.default('tradle:sls:objects');
const Embed = require("@tradle/embed");
const types = require("./typeforce-types");
const errors_1 = require("./errors");
const constants_1 = require("./constants");
const utils_1 = require("./utils");
const crypto_1 = require("./crypto");
const { MESSAGE } = constants_1.TYPES;
class Objects {
    constructor({ env, buckets, s3Utils }) {
        this.addMetadata = object => Objects.addMetadata(object);
        this.replaceEmbeds = (object) => __awaiter(this, void 0, void 0, function* () {
            const replacements = Embed.replaceDataUrls({
                region: this.env.region,
                bucket: this.fileUploadBucketName,
                keyPrefix: '',
                object
            });
            if (replacements.length) {
                debug(`replaced ${replacements.length} embedded media`);
                yield Promise.all(replacements.map(replacement => {
                    const { bucket, key, body } = replacement;
                    return this.s3Utils.put({ bucket, key, value: body });
                }));
            }
        });
        this.resolveEmbed = (embed) => {
            debug(`resolving embedded media: ${embed.url}`);
            return embed.presigned
                ? utils_1.download(embed)
                : this.s3Utils.get(embed).then(({ Body, ContentType }) => {
                    Body.mimetype = ContentType;
                    return Body;
                });
        };
        this.resolveEmbeds = (object) => {
            return Embed.resolveEmbeds({ object, resolve: this.resolveEmbed });
        };
        this.getObjectByLink = (link) => {
            utils_1.typeforce(utils_1.typeforce.String, link);
            debug('getting', link);
            return this.bucket.getJSON(link);
        };
        this.putObject = (object) => __awaiter(this, void 0, void 0, function* () {
            utils_1.typeforce(types.signedObject, object);
            this.addMetadata(object);
            object = utils_1.deepClone(object);
            yield this.replaceEmbeds(object);
            debug('putting', object[constants_1.TYPE], object._link);
            return this.bucket.putJSON(object._link, object);
        });
        this.prefetchByLink = (link) => {
            return this.getObjectByLink(link);
        };
        this.del = (link) => {
            return this.bucket.del(link);
        };
        this.presignEmbeddedMediaLinks = ({ object, stripEmbedPrefix }) => {
            Embed.presignUrls({
                object,
                sign: ({ bucket, key, path }) => {
                    debug(`pre-signing url for ${object[constants_1.TYPE]} property ${path}`);
                    return this.s3Utils.createPresignedUrl({ bucket, key });
                }
            });
            if (stripEmbedPrefix) {
                Embed.stripEmbedPrefix(object);
            }
            return object;
        };
        this.env = env;
        this.buckets = buckets;
        this.bucket = this.buckets.Objects;
        this.s3Utils = s3Utils;
        this.fileUploadBucketName = buckets.FileUpload.name;
    }
}
Objects.addMetadata = (object) => {
    utils_1.typeforce(types.signedObject, object);
    const type = object[constants_1.TYPE];
    if (!object._sigPubKey) {
        let pubKey;
        try {
            pubKey = crypto_1.extractSigPubKey(object);
        }
        catch (err) {
            debug('invalid object', JSON.stringify(object), err);
            throw new errors_1.InvalidSignature(`for ${type}`);
        }
        utils_1.setVirtual(object, { _sigPubKey: pubKey.pub });
    }
    crypto_1.addLinks(object);
    return object;
};
exports.default = Objects;
//# sourceMappingURL=objects.js.map