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
const dotProp = require("dot-prop");
const clone = require("clone");
const deepEqual = require("deep-equal");
const utils_1 = require("../../utils");
const configure_1 = require("../configure");
const Errors = require("../../errors");
exports.EMPLOYEE_COMMANDS = [
    'help',
    'listproducts',
    'forgetme',
    'setproductenabled',
    'setautoverify',
    'addfriend',
    'tours'
];
exports.CUSTOMER_COMMANDS = [
    'help',
    'listproducts',
    'forgetme',
    'tours'
];
exports.createEditConfOp = edit => (opts) => __awaiter(this, void 0, void 0, function* () {
    const { bot, conf } = opts.context;
    const current = clone(conf);
    let makeEdit = edit(opts);
    if (utils_1.isPromise(makeEdit))
        makeEdit = yield makeEdit;
    if (deepEqual(conf, current)) {
        throw new Error('you changed...nothing');
    }
    else {
        const confManager = new configure_1.Conf({ bot });
        yield confManager.saveBotConf(conf);
    }
});
exports.setProperty = exports.createEditConfOp(({ context, req, path, value }) => {
    dotProp.set(context.conf, path, value);
});
exports.toggleProduct = exports.createEditConfOp(({ context, req, product, enable }) => __awaiter(this, void 0, void 0, function* () {
    const { bot, productsAPI, conf } = context;
    const { products, models } = productsAPI;
    const byTitle = Object.keys(models.all)
        .find(id => models.all[id].title.toLowerCase() === product.toLowerCase());
    if (byTitle)
        product = byTitle;
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
    conf.products.enabled = newProductsList;
}));
exports.getAvailableCommands = ({ context, req }) => {
    const isEmployee = context.employeeManager.isEmployee(req.user);
    return isEmployee ? exports.EMPLOYEE_COMMANDS : exports.CUSTOMER_COMMANDS;
};
exports.getCommandByName = commandName => {
    let command;
    try {
        command = require('./commands')[commandName.toLowerCase()];
    }
    catch (err) { }
    if (!command) {
        throw new Errors.NotFound(`command not found: ${commandName}`);
    }
    return command;
};
//# sourceMappingURL=utils.js.map