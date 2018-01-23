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
const url_1 = require("url");
const lodash_1 = require("lodash");
const parse = require("yargs-parser");
const buildResource = require("@tradle/build-resource");
const validateResource = require("@tradle/validate-resource");
const models = require("../../../models");
const Errors = require("../../../errors");
const { parseStub } = validateResource.utils;
const description = `add a known provider by url.
Models received from them will be limited to the namespace corresponding to the provider --domain option`;
const EXAMPLE = `/addfriend "https://example.com" --domain example.com`;
const USAGE = `
${EXAMPLE}

Keep in mind that "domain" will be used to validate the namespace of foreign models.`;
exports.command = {
    name: 'addfriend',
    description,
    examples: [
        '/addfriend tradle.example.com --domain tradle.example.com',
        '/addfriend https://tradle.example.com --domain tradle.example.com',
    ],
    parse: (argsStr) => {
        const args = parse(argsStr);
        const { domain } = args;
        let url = args._[0];
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }
        const { hostname } = url_1.parse(url);
        if (!domain) {
            throw new Error(`expected "--domain", for example: ${USAGE}`);
        }
        return { url, domain };
    },
    exec: function ({ commander, req, args }) {
        return __awaiter(this, void 0, void 0, function* () {
            const { url, domain } = args;
            const friend = yield commander.bot.friends.load({ domain, url });
            const friendStub = buildResource.stub({
                models,
                resource: friend
            });
            const userId = friend._identityPermalink;
            const { users } = commander.bot;
            let user;
            try {
                user = yield users.get(userId);
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
                yield users.save({ id: userId, friend: friendStub });
            }
            if (user && !lodash_1.isEqual(user.friend, friendStub)) {
                user.friend = friend.permalink;
                yield users.merge({ id: userId, friend: friendStub });
            }
            return friend;
        });
    },
    sendResult: ({ commander, req, args, result }) => __awaiter(this, void 0, void 0, function* () {
        yield commander.sendSimpleMessage({
            req,
            message: `added friend ${result.name} from ${args.url}`
        });
    })
};
//# sourceMappingURL=addfriend.js.map