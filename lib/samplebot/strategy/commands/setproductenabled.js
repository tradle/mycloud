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
const yn = require("yn");
const parse = require("yargs-parser");
const utils_1 = require("../utils");
exports.default = {
    name: 'setproductenabled',
    description: 'enable/disable a product',
    examples: [
        '/setproductenabled my.custom.Product',
        '/setproductenabled my.custom.Product false',
    ],
    exec: function ({ context, req, command }) {
        return __awaiter(this, void 0, void 0, function* () {
            const { bot } = context;
            const args = parse(command);
            const product = args._[0];
            const enable = yn(args._[1] || true);
            yield utils_1.toggleProduct({ context, req, product, enable });
            const verb = enable ? 'enabled' : 'disabled';
            const message = `${verb} product ${product}. Give me ~30 seconds to process this doozy.`;
            bot.debug(message);
            yield context.sendSimpleMessage({ req, message });
        });
    }
};
//# sourceMappingURL=setproductenabled.js.map