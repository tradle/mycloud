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
    name: 'tours',
    examples: [
        '/tours',
        '/tours intro'
    ],
    description: 'list tours or view a tour',
    parse: (argsStr) => {
        const args = parse(argsStr);
        return {
            name: args._[0]
        };
    },
    exec: ({ commander, req, args }) => __awaiter(this, void 0, void 0, function* () {
        const { name } = args;
        const { tours } = commander.conf;
        if (!name) {
            return Object.keys(tours);
        }
        const tour = tours[name];
        if (!tour) {
            throw new Error(`Tour "${name}" not found. List tours with /tours`);
        }
        return tour;
    }),
    sendResult: ({ commander, req, result }) => __awaiter(this, void 0, void 0, function* () {
        if (Array.isArray(result)) {
            const list = result.join('\n');
            yield commander.sendSimpleMessage({
                req,
                message: `Available Tours:\n\n${list}`
            });
        }
        else {
            yield commander.send({
                req,
                object: result
            });
        }
    })
};
//# sourceMappingURL=tours.js.map