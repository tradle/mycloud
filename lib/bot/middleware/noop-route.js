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
exports.route = (methods, path = '/') => {
    const router = new Router();
    [].concat(methods).forEach(method => {
        router[method](path, (ctx, next) => __awaiter(this, void 0, void 0, function* () {
            yield next();
        }));
    });
    return router.routes();
};
exports.get = path => exports.route('get', path);
exports.put = path => exports.route('put', path);
exports.post = path => exports.route('post', path);
exports.del = path => exports.route('del', path);
exports.head = path => exports.route('head', path);
//# sourceMappingURL=noop-route.js.map