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
exports.default = {
    name: 'tours',
    examples: [
        '/tours',
        '/tours intro'
    ],
    description: 'list tours or view a tour',
    exec: function ({ context, req, command }) {
        return __awaiter(this, void 0, void 0, function* () {
            const args = parse(command);
            const name = args._[0];
            const { tours } = context.conf;
            if (!name) {
                const list = Object.keys(tours).join('\n');
                yield context.sendSimpleMessage({
                    req,
                    message: `Available Tours:\n\n${list}`
                });
                return;
            }
            const tour = tours[name];
            if (!tour) {
                yield context.sendSimpleMessage({
                    req,
                    message: `Tour "${name}" not found. List tours with /tours`
                });
                return;
            }
            yield context.send({
                req,
                object: tour
            });
        });
    }
};
//# sourceMappingURL=tours.js.map