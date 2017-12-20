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
const compose = require("koa-compose");
const koaBody = require("koa-body");
exports.bodyParser = (opts) => {
    const parser = koaBody(opts);
    const setEvent = (ctx, next) => __awaiter(this, void 0, void 0, function* () {
        ctx.event = ctx.request.body;
        yield next();
    });
    return compose([parser, setEvent]);
};
//# sourceMappingURL=body-parser.js.map