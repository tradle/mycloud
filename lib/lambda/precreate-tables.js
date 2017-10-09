"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const configure_provider_1 = require("../configure-provider");
const wrap = require("../wrap");
const samplebot_1 = require("../../samplebot");
exports.handler = wrap(event => configure_provider_1.preCreateTables({ db: samplebot_1.db, ids: event }));
//# sourceMappingURL=precreate-tables.js.map