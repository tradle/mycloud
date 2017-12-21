"use strict";
module.exports = function getTables({ serviceMap, dbUtils }) {
    const { getTable } = dbUtils;
    function loadTable(name) {
        if (!tables[name]) {
            tables[name] = getTable(serviceMap.Table[name]);
        }
    }
    const tables = {};
    Object.keys(serviceMap.Table).forEach(loadTable);
    return tables;
};
//# sourceMappingURL=tables.js.map