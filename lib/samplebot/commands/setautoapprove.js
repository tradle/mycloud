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
    name: 'setautoapprove',
    examples: [
        '/setautoapprove',
        '/setautoapprove false'
    ],
    description: 'toggle whether verifications are issued automatically for forms',
    parse: (argsStr) => {
        const args = parse(argsStr);
        return {
            value: yn(args._[0] || true)
        };
    },
    exec: function ({ commander, req, args }) {
        return __awaiter(this, void 0, void 0, function* () {
            const { value } = args;
            const path = 'products.autoApprove';
            yield utils_1.setProperty({ commander, req, path, value });
            commander.logger.debug(`set ${path} to ${value}`);
            yield commander.sendSimpleMessage({
                req,
                message: `Done. Give me ~30 seconds to process this doozy.`
            });
        });
    }
};
//# sourceMappingURL=setautoapprove.js.map