// const lazy = require('./lazy')(require, exports)

// lazy('stableStringify', 'json-stable-stringify')

export const stableStringify = require('json-stable-stringify')
export const safeStringify = require('json-stringify-safe')

export const toCamelCase = (str, delimiter, upperFirst) => {
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
export const splitCamelCase = (str, delimiter=' ', upperFirst) => {
  const split = str.slice(0, 1) + str.slice(1)
    // insert a space before all caps
    .replace(/([A-Z])/g, delimiter + '$1')
    .trim()

  return upperFirst ? upperCaseFirstCharacter(split) : split
}


export const prettify = (obj) => {
  return JSON.stringify(obj, bufferReplacer, 2)
}

export const alphabetical = (a, b) => {
  if (a === b) return 0
  if (a < b) return -1
  return 1
}

function upperCaseFirstCharacter (str) {
  return str[0].toUpperCase() + str.slice(1).toLowerCase()
}

function bufferReplacer (key, value) {
  // Filtering out properties
  if (isLikeBuffer(value)) {
    // don't prettify buffer
    return JSON.stringify(value)
  }

  return value
}

function isLikeBuffer (value) {
  return typeof value === 'object' &&
    value &&
    Object.keys(value).length === 2 &&
    value.type === 'Buffer' &&
    Array.isArray(value.data)
}
