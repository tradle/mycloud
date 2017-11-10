const corpModels = require('@tradle/models-corporate-onboarding');
const messageInterface = require('./message-interface');
if (messageInterface !== 'tradle.Message') {
    for (let id in corpModels) {
        let { interfaces = [] } = corpModels[id];
        let idx = interfaces.indexOf('tradle.Message');
        if (idx !== -1) {
            if (messageInterface) {
                interfaces[idx] = messageInterface;
            }
            else {
                interfaces.splice(idx, 1);
            }
        }
    }
}
module.exports = namespace => {
    return corpModels;
};
//# sourceMappingURL=bank-models.js.map