"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) if (e.indexOf(p[i]) < 0)
            t[p[i]] = s[p[i]];
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const ADDITIONAL_OPTS = ['kmsKeyId'];
exports.command = {
    name: 'encryptbucket',
    description: 'set encryption on an s3 bucket',
    examples: [
        '/encryptbucket --bucket <bucketLogicalId> --enable <true/false> --kmsKeyId'
    ],
    exec: ({ commander, args }) => __awaiter(this, void 0, void 0, function* () {
        let { bucket, enable = true } = args, opts = __rest(args, ["bucket", "enable"]);
        if (bucket.endsWith('Bucket')) {
            bucket = bucket.slice(0, bucket.length - 6);
        }
        const { buckets } = commander.bot;
        const bucketInstance = buckets[bucket] || Object.keys(buckets)
            .map(logicalId => buckets[logicalId])
            .find(instance => instance.name === bucket);
        if (!bucketInstance)
            throw new Error(`bucket ${bucket} not found`);
        opts = _.pick(opts, ADDITIONAL_OPTS);
        if (enable) {
            yield bucketInstance.enableEncryption(opts);
        }
        else {
            yield bucketInstance.disableEncryption(opts);
        }
        return {
            bucket: bucketInstance.name,
            encryption: _.extend({ enabled: enable }, opts)
        };
    }),
    sendResult: ({ commander, req, result, to, args }) => __awaiter(this, void 0, void 0, function* () {
        const verb = args.enable === false ? 'disabled' : 'enabled';
        yield commander.sendSimpleMessage({
            req,
            to,
            message: `${verb} encryption on bucket ${args.bucket}`
        });
    })
};
//# sourceMappingURL=encryptbucket.js.map