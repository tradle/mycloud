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
const HELP_MENU_CUSTOMER = `**/help** - see this menu
**/products** - see the list of products
**/forgetme** - exercise your right to be forgotten`;
const HELP_MENU_EMPLOYEE = `${HELP_MENU_CUSTOMER}
**/enableproduct [productId]** - enable a product
**/disableproduct [productId]** - disable a product
`;
exports.default = {
    name: 'help',
    description: 'show the command menu',
    exec: function ({ context, req, command }) {
        return __awaiter(this, void 0, void 0, function* () {
            const { employeeManager } = context;
            const message = employeeManager.isEmployee(req.user)
                ? HELP_MENU_EMPLOYEE
                : HELP_MENU_CUSTOMER;
            yield context.sendSimpleMessage({ req, message });
        });
    }
};
//# sourceMappingURL=help.js.map