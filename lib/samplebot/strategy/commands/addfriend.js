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
    name: 'addfriend',
    description: 'add a known provider by url',
    examples: [
        '/addfriend tradle.example.com',
        '/addfriend https://tradle.example.com',
    ],
    exec: function ({ context, req, command }) {
        return __awaiter(this, void 0, void 0, function* () {
            const args = parse(command);
            let url = args._[0];
            if (!url.startsWith('http')) {
                url = 'https://' + url;
            }
            debugger;
            const friend = yield context.bot.friends.load({ url });
            yield context.sendSimpleMessage({
                req,
                message: `added friend ${friend.name} from ${url}`
            });
        });
    }
};
//# sourceMappingURL=addfriend.js.map