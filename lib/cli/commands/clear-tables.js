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
const command_1 = require("../command");
const string_utils_1 = require("../../string-utils");
const skip = [
    'pubkeys',
    'presence',
    'events',
    'seals',
    'tradle_MyCloudFriend'
];
class ClearTables extends command_1.default {
    constructor(cli) {
        super(cli);
        this.exec = (names) => __awaiter(this, void 0, void 0, function* () {
            const tables = yield this.getTables(names);
            yield this.clearTables(tables);
        });
        this.getTables = (names) => __awaiter(this, void 0, void 0, function* () {
            const { tradle, env } = this;
            if (names.length) {
                return names.map(name => {
                    return name.startsWith(env.SERVERLESS_PREFIX) ? name : env.SERVERLESS_PREFIX + name;
                });
            }
            const list = yield tradle.dbUtils.listTables(env);
            return list.filter(name => {
                return !skip.find(skippable => env.SERVERLESS_PREFIX + skippable === name);
            });
        });
        this.clearTables = (names) => __awaiter(this, void 0, void 0, function* () {
            const { href } = this.tradle.aws.dynamodb.endpoint;
            yield this.confirm(`will empty the following tables at endpoint ${href}\n${string_utils_1.prettify(names)}`);
            for (const table of names) {
                this.logger.debug('clearing', table);
                const numDeleted = yield this.tradle.dbUtils.clear(table);
                this.logger.debug(`deleted ${numDeleted} items from ${table}`);
            }
        });
        this.logger = cli.logger.sub('clear-tables');
    }
}
ClearTables.requiresConfirmation = true;
ClearTables.description = 'this will clear tables in the REMOTE DynamoDB';
exports.default = ClearTables;
//# sourceMappingURL=clear-tables.js.map