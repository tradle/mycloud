"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _1 = require("../");
const { configureProvider: { preCreateTables } } = _1.tradle;
const wrap = require("../wrap");
const samplebot_1 = require("../../samplebot");
exports.handler = wrap(event => preCreateTables({ productsAPI: samplebot_1.productsAPI, ids: event }));
//# sourceMappingURL=precreate-tables.js.map