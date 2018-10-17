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

export const splitCamelCase = (str, delimiter=' ', upFirst) => {
  const parts = splitCamelCaseToArray(str)
  if (upFirst) {
    parts[0] = upperFirst(parts[0])
  }

  return parts.join(delimiter)
}

// https://stackoverflow.com/questions/18379254/regex-to-split-camel-case/18379502
export const splitCamelCaseToArray = (str: string) => str.split(/(?=[A-Z])/)

const hasUpperAndLowerCase = (str: string) => str.toUpperCase() !== str.toLowerCase()

const isUpperCase = (ch: string) => hasUpperAndLowerCase(ch) && ch.toUpperCase() === ch
const isLowerCase = (ch: string) => hasUpperAndLowerCase(ch) && ch.toLowerCase() === ch

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
