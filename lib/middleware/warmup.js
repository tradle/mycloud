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
const fs = require("fs");
const utils_1 = require("../utils");
const constants_1 = require("../constants");
exports.warmup = (lambda, opts = {}) => {
    const { source = constants_1.WARMUP_SOURCE_NAME } = opts;
    return (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        const { event, context } = ctx;
        if (event.source !== source) {
            yield next();
            return;
        }
        const sleep = event.sleep || opts.sleep || constants_1.WARMUP_SLEEP;
        lambda.logger.debug(`warmup, sleeping for ${sleep}ms`);
        yield utils_1.wait(sleep);
        let uptime;
        if (!(lambda.isUsingServerlessOffline || lambda.env.IS_LOCAL)) {
            uptime = fs.readFileSync('/proc/uptime', { encoding: 'utf-8' });
        }
        ctx.body = {
            containerAge: lambda.containerAge,
            containerId: lambda.containerId,
            uptime,
            logStreamName: context.logStreamName,
            isVirgin: lambda.isVirgin
        };
    });
};
//# sourceMappingURL=warmup.js.map