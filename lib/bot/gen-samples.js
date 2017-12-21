"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const Gen = require("@tradle/gen-samples");
const getParams = ({ httpMethod, body, queryStringParameters }) => {
    if (httpMethod === 'POST') {
        return typeof body === 'string' ? JSON.parse(body) : body;
    }
    const params = {
        users: Number(queryStringParameters.users),
        products: JSON.parse(queryStringParameters.products)
    };
    return params;
};
module.exports = function genSamples({ bot, event }) {
    return __awaiter(this, void 0, void 0, function* () {
        const { TESTING } = bot.env;
        const { users, products } = TESTING ? getParams(event) : event;
        if (typeof users !== 'number')
            throw new Error('expected number "users"');
        const { models, db } = bot;
        if (!Array.isArray(products)) {
            throw new Error('expected array "products"');
        }
        products.forEach(id => {
            const model = models[id];
            if (!model || model.subClassOf !== 'tradle.FinancialProduct') {
                throw new Error(`${id} is not a FinancialProduct`);
            }
        });
        const gen = Gen.samples({ models });
        const samples = new Array(users).fill(0).map(() => {
            return gen.user({ products });
        })
            .reduce((all, some) => all.concat(some), []);
        yield db.batchPut(samples);
        if (TESTING) {
            return {
                statusCode: 200
            };
        }
    });
};
//# sourceMappingURL=gen-samples.js.map