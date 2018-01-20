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
exports.command = {
    name: 'listproducts',
    examples: [
        '/listproducts'
    ],
    aliases: [
        '/lsproducts',
        '/ls-products'
    ],
    description: 'see a list of products',
    exec: ({ context, req }) => __awaiter(this, void 0, void 0, function* () {
        return context.conf.bot.products.enabled.slice()
            .map(id => {
            const model = context.bot.modelStore.models[id];
            const title = model ? model.title : '';
            return { id, title };
        });
    }),
    sendResult: ({ context, req, result }) => __awaiter(this, void 0, void 0, function* () {
        if (context.employeeManager.isEmployee(req.user)) {
            const enabled = result
                .map(({ id, title }) => `${title} (${id})`)
                .join('\n');
            const message = `enabled products:\n\n${enabled}`;
            yield context.sendSimpleMessage({ req, message });
        }
        else {
            yield context.productsAPI.sendProductList({ to: req.user });
        }
    })
};
//# sourceMappingURL=listproducts.js.map