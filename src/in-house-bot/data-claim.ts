import { findKey } from 'lodash'
import protobuf = require('protocol-buffers')
import {
  ClaimType,
  ClaimStub
} from './types'

const ENCODING = 'hex'
const schema = protobuf(`
  enum ClaimType {
    dump = 1;
    prefill = 2;
  }

  message ClaimStub {
    required ClaimType claimType = 1;
    required bytes key = 2;
    required bytes nonce = 3;
  }
`)

const toBuffer = (val:Buffer|string) => Buffer.isBuffer(val) ? val : new Buffer(val, ENCODING)
const toString = (val:Buffer|string) => Buffer.isBuffer(val) ? val.toString(ENCODING) : val

export const stubToId = ({ claimType, key, nonce }) => {
  return schema.ClaimStub.encode({
    claimType: claimType in schema.ClaimType ? schema.ClaimType[claimType] : claimType,
    key: toBuffer(key),
    nonce: toBuffer(nonce)
  })
  .toString(ENCODING)
}

export const idToStub = (data:Buffer|string):ClaimStub => {
  const claimId = toString(data)
  const { claimType, key, nonce } = schema.ClaimStub.decode(toBuffer(data))
  return {
    claimId,
    claimType: <ClaimType>findKey(schema.ClaimType, (v, k) => schema.ClaimType[k] === claimType),
    key: toString(key),
    nonce: toString(nonce)
  }
}
