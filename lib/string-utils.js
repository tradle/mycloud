exports.stableStringify = require('json-stable-stringify');
exports.toCamelCase = function toCamelCase(str, delimiter, upperFirst) {
    return str
        .split(delimiter)
        .map((part, i) => {
        if (i === 0 && !upperFirst) {
            return part.toLowerCase();
        }
        return upperCaseFirstCharacter(part);
    })
        .join('');
};
exports.splitCamelCase = function splitCamelCase(str, delimiter = ' ', upperFirst) {
    const split = str.slice(0, 1) + str.slice(1)
        .replace(/([A-Z])/g, delimiter + '$1')
        .trim();
    return upperFirst ? upperCaseFirstCharacter(split) : split;
};
exports.prettify = function prettify(obj) {
    return JSON.stringify(obj, bufferReplacer, 2);
};
exports.alphabetical = function alphabetical(a, b) {
    if (a === b)
        return 0;
    if (a < b)
        return -1;
    return 1;
};
function upperCaseFirstCharacter(str) {
    return str[0].toUpperCase() + str.slice(1).toLowerCase();
}
function stringifyWithFlatBuffers(value, spacing) {
    return JSON.stringify(value, bufferReplacer, spacing);
}
function bufferReplacer(key, value) {
    if (isLikeBuffer(value)) {
        return JSON.stringify(value);
    }
    return value;
}
function isLikeBuffer(value) {
    return typeof value === 'object' &&
        value &&
        Object.keys(value).length === 2 &&
        value.type === 'Buffer' &&
        Array.isArray(value.data);
}
//# sourceMappingURL=string-utils.js.map