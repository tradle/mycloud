const format = require('string-format');
const { custom: { prefix } } = require('../cli/serverless-yml');
const map = require('./fixtures/fake-service-map');
for (let logicalId in map) {
    map[logicalId] = format(map[logicalId], { prefix });
}
module.exports = map;
//# sourceMappingURL=service-map.js.map