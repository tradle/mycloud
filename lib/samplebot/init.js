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
const configure_1 = require("./configure");
const Errors = require("../errors");
class Init {
    constructor({ bot }) {
        this.ensureInitialized = (conf) => __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.bot.getMyIdentity();
            }
            catch (err) {
                Errors.ignore(err, Errors.NotFound);
                yield this.init(conf);
            }
        });
        this.init = (conf) => __awaiter(this, void 0, void 0, function* () {
            yield this.confManager.init(conf);
        });
        this.update = (conf) => __awaiter(this, void 0, void 0, function* () {
            yield this.confManager.update(conf);
        });
        this.recalcPublicInfo = () => __awaiter(this, void 0, void 0, function* () {
            yield this.confManager.recalcPublicInfo();
        });
        this.bot = bot;
        this.logger = bot.logger;
        this.confManager = new configure_1.Conf({ bot });
    }
}
exports.Init = Init;
//# sourceMappingURL=init.js.map