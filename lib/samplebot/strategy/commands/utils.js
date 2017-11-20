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
exports.toggleProduct = ({ context, req, product, enable }) => __awaiter(this, void 0, void 0, function* () {
    const { bot, productsAPI, conf } = context;
    const { products, models } = productsAPI;
    if (enable && products.includes(product)) {
        throw new Error(`product ${product} is already enabled!`);
    }
    if (!enable && !products.includes(product)) {
        throw new Error(`product ${product} is not enabled!`);
    }
    const model = models.all[product];
    if (!model) {
        throw new Error(`model not found: ${product}`);
    }
    if (model.subClassOf !== 'tradle.FinancialProduct') {
        throw new Error(`model ${product} is not a tradle.FinancialProduct`);
    }
    const newProductsList = enable
        ? products.concat(product)
        : products.filter(id => id !== product);
    const privateConf = yield conf.getPrivateConf();
    privateConf.products.enabled = newProductsList;
    yield conf.savePrivateConf(privateConf);
    const verb = enable ? 'enabled' : 'disabled';
    const message = `${verb} product ${product}`;
    bot.debug(message);
    yield context.sendSimpleMessage({ req, message });
});
//# sourceMappingURL=utils.js.map