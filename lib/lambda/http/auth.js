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
const Router = require("koa-router");
const cors = require("kcors");
const bodyParser = require("koa-body");
const _1 = require("../../");
const lambda_1 = require("../../lambda");
const lambda = new lambda_1.Lambda({
    source: lambda_1.EventSource.HTTP,
    tradle: _1.tradle
});
const router = new Router();
router.post('/auth', (ctx) => __awaiter(this, void 0, void 0, function* () {
    ctx.body = yield _1.tradle.user.onSentChallengeResponse(ctx.request.body);
}));
lambda.use(cors());
lambda.use(bodyParser());
lambda.use(router.routes());
exports.handler = lambda.handler;
//# sourceMappingURL=auth.js.map