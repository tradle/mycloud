// const lazy = require('./lazy')(require, exports)

// lazy('stableStringify', 'json-stable-stringify')

import upperFirst from 'lodash/upperFirst'
export const stableStringify = require('json-stable-stringify')
export const safeStringify = require('json-stringify-safe')
export const format = require('string-format')

export { upperFirst }
export const toCamelCase = (str, delimiter, upFirst) => {
  return str
    .split(delimiter)
    .map((part, i) => {
      if (i === 0 && !upFirst) {
        return part.toLowerCase()
      }

      return upperFirst(part)
    })
    .join('')
}

// https://stackoverflow.com/questions/4149276/javascript-camelcase-to-regular-form
export const splitCamelCase = (str, delimiter=' ', upFirst) => {
  const split = str.slice(0, 1) + str.slice(1)
    // insert a space before all caps
    .replace(/([A-Z])/g, delimiter + '$1')
    .trim()

  return upFirst ? upperFirst(split) : split
}

export const splitCamelCaseToArray = (str: string) => {
  let lowerCasePrefix = ''
  for (const ch of str) {
    if (isUpperCase(ch)) break

    lowerCasePrefix += ch
  }

  const rest = str.match(/[A-Z][^A-Z]*/g).slice()
  return lowerCasePrefix ? [lowerCasePrefix, ...rest] : rest
}

const isUpperCase = (ch: string) => ch.toUpperCase() === ch
const isLowerCase = (ch: string) => ch.toLowerCase() === ch

export const replaceAll = (str: string, search: string, replacement: string) => {
  return str.split(search).join(replacement)
}

export const prettify = (obj) => {
  return JSON.stringify(obj, bufferReplacer, 2)
}

export const alphabetical = (a, b) => {
  if (a === b) return 0
  if (a < b) return -1
  return 1
}

const HEX_REGEX = /^[0-9A-F]+$/i
export const isHex = str => HEX_REGEX.test(str)

export const trimTrailingSlashes = str => str.replace(/[\/]+$/, '')
export const trimLeadingSlashes = str => str.replace(/^[\/]+/, '')

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
