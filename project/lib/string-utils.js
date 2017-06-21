// const lazy = require('./lazy')(require, exports)

// lazy('stableStringify', 'json-stable-stringify')

exports.toCamelCase = function toCamelCase (str, delimiter, upperFirst) {
  return str
    .split(delimiter)
    .map((part, i) => {
      if (i === 0 && !upperFirst) {
        return part.toLowerCase()
      }

      return upperCaseFirstCharacter(part)
    })
    .join('')
}

// https://stackoverflow.com/questions/4149276/javascript-camelcase-to-regular-form
exports.splitCamelCase = function splitCamelCase (str, delimiter=' ', upperFirst) {
  const split = str.slice(0, 1) + str.slice(1)
    // insert a space before all caps
    .replace(/([A-Z])/g, delimiter + '$1')
    .trim()

  return upperFirst ? upperCaseFirstCharacter(split) : split
}


exports.prettify = function prettify (obj) {
  return JSON.stringify(obj, bufferReplacer, 2)
}

function upperCaseFirstCharacter (str) {
  return str[0].toUpperCase() + str.slice(1).toLowerCase()
}

function stringifyWithFlatBuffers (value, spacing) {
  return JSON.stringify(value, bufferReplacer, spacing)
}

function bufferReplacer (key, value) {
  // Filtering out properties
  if (Object.keys(value).length === 2 && value.type === 'Buffer' && Array.isArray(value.data)) {
    // don't prettify buffer
    return JSON.stringify(value)
  }

  return value
}
