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
exports.command = {
    name: 'setproductenabled',
    description: 'enable/disable a product',
    examples: [
        '/setproductenabled my.custom.Product',
        '/setproductenabled my.custom.Product false',
    ],
    parse: (argsStr) => {
        const args = parse(argsStr);
        return {
            product: args._[0],
            enable: yn(args._[1] || true)
        };
    },
    exec: function ({ commander, req, args }) {
        return __awaiter(this, void 0, void 0, function* () {
            const { product, enable } = args;
            const { bot } = commander;
            yield utils_1.toggleProduct({ commander, req, product, enable });
            return {
                product,
                enabled: enable
            };
        });
    },
    sendResult: ({ commander, req, result }) => __awaiter(this, void 0, void 0, function* () {
        const { enabled, product } = result;
        const verb = enabled ? 'enabled' : 'disabled';
        const message = `${verb} product ${product}. Give me ~30 seconds to process this doozy.`;
        commander.bot.debug(message);
        yield commander.sendSimpleMessage({ req, message });
    })
};
//# sourceMappingURL=setproductenabled.js.map