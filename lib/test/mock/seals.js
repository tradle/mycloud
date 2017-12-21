"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const utils_1 = require("../utils");
module.exports = function fakeSeals(opts = {}) {
    const { seals = {} } = opts;
    return {
        create: ({ link }) => __awaiter(this, void 0, void 0, function* () {
            seals[link] = { link };
        }),
        get: utils_1.getter(seals)
    };
};
//# sourceMappingURL=seals.js.map