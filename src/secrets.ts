
// @ts-ignore
import Promise from 'bluebird'
import AWS from 'aws-sdk'
import { IPrivKey, IIdentity } from './types'
import * as crypto from './crypto'
import Errors from './errors'
import { gzip, gunzip } from './utils'

const KEYS_SECRET_NAME = 'keys'
const KEYS_CONTEXT = {
  identityKeys: '1'
}

const DIGEST = 'sha256'

type Digest = 'sha256' | 'sha512'

type CredstashPutSecretOpts = {
  name: string
  secret: Buffer
  digest: Digest
  context?: any
}

type CredstashGetSecretOpts = {
  name: string
  version?: string
  context?: any
}

type CredstashDeleteSecretOpts = {
  name: string
  version: string
}

type CredstashDeleteSecretsOpts = {
  name: string
}

type PutSecretOpts = {
  key: string
  value: any
  digest?: Digest
  context?: any
}

type GetSecretOpts = {
  key: string
  version?: string
  context?: any
}

interface ICredstash {
  get(opts:CredstashGetSecretOpts): Promise<any>
  putSecret(opts:CredstashPutSecretOpts): Promise<any>
  deleteSecret(opts:CredstashDeleteSecretOpts)
  deleteSecrets(opts:CredstashDeleteSecretsOpts)
}

type SecretsOpts = {
  credstash: ICredstash
}

const encode = (buf: Buffer, gzipped?: boolean) => {
  const encoded = Buffer.alloc(buf.length + 1)
  encoded[0] = gzipped ? 1 : 0
  buf.copy(encoded, 1)
  return encoded
}

const decode = (buf: Buffer) => {
  return {
    gzipped: buf[0] === 1,
    data: buf.slice(1)
  }
}

export default class Secrets {
  private credstash: ICredstash
  constructor({ credstash }: SecretsOpts) {
    this.credstash = credstash
  }

  public getSecret = async ({ key, version, context = {} }: GetSecretOpts) => {
    const buf = await this.credstash.get({
      name: key,
      context
    })

    return await this._decode(buf)
  }

  public putSecret = async ({ key, value, digest=DIGEST, context = {} }: PutSecretOpts) => {
    const secret = await this._encode(value)
    return await this.credstash.putSecret({
      name: key,
      context,
      digest,
      secret
    })
  }

  public deleteSecret = async (name) => {
    return await this.credstash.deleteSecrets({ name })
  }

  public putIdentityKeys = async ({ keys }: {
    keys: IPrivKey[]
  }) => {
    return await this.putSecret({
      key: KEYS_SECRET_NAME,
      value: keys,
      context: KEYS_CONTEXT
    })
  }

  public getIdentityKeys = async () => {
    const buf = await this.getSecret({
      key: KEYS_SECRET_NAME,
      context: KEYS_CONTEXT
    })

    return JSON.parse(buf)
  }

  public delIdentityKeys = async () => {
    await this.deleteSecret(KEYS_SECRET_NAME)
  }

  private _encode = async (value: any):Promise<Buffer> => {
    if (Buffer.isBuffer(value)) {
      return encode(value)
    }

    return encode(await gzip(JSON.stringify(value)), true)
  }

  private _decode = async (value: Buffer) => {
    const { gzipped, data } = decode(value)
    if (gzipped) return await gunzip(data)

    return data
  }
}

export { Secrets }
