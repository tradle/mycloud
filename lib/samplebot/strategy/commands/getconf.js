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
const _ = require("lodash");
const parse = require("yargs-parser");
exports.command = {
    name: 'getconf',
    description: 'get current bot configuration',
    examples: [
        '/getconf --conf',
        '/getconf --models',
        '/getconf --style'
    ],
    parse: (argsStr) => {
        const args = parse(argsStr);
        return args;
    },
    exec: ({ context, req, args, argsStr }) => __awaiter(this, void 0, void 0, function* () {
        const { conf } = context;
        if (args.bot) {
            return conf.bot;
        }
        if (args.products) {
            return _.pick(conf.bot.products, ['enabled', 'approveAllEmployees', 'autoApprove']);
        }
        if (args.conf) {
            return conf;
        }
        if (args.style) {
            return conf.style;
        }
        if (args.terms) {
            return conf.termsAndConditions;
        }
        if (args.models) {
            return conf.modelsPack;
        }
        throw new Error(`unrecognized options: ${argsStr}`);
    })
};
//# sourceMappingURL=getconf.js.map