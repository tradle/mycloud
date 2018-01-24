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
const parse = require("yargs-parser");
exports.command = {
    name: 'deny',
    description: 'deny an application',
    examples: [
        '/deny <application permalink>'
    ],
    parse: (argsStr) => {
        return {
            application: parse(argsStr)._[0]
        };
    },
    exec: ({ commander, req, ctx, args }) => __awaiter(this, void 0, void 0, function* () {
        yield commander.judgeApplication({ req, application: args.application, approve: false });
    }),
    sendResult: ({ commander, req, to }) => __awaiter(this, void 0, void 0, function* () {
        yield commander.sendSimpleMessage({ req, to, message: 'application denied!' });
    })
};
//# sourceMappingURL=deny.js.map