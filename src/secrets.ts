
// @ts-ignore
import Promise from 'bluebird'
import _ from 'lodash'
import AWS from 'aws-sdk'
import { IPrivKey, IIdentity } from './types'
import * as crypto from './crypto'
import Errors from './errors'
import { gzip, gunzip } from './utils'

const KEYS_SECRET_NAME = 'identity-keys'
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
  put(opts:CredstashPutSecretOpts): Promise<any>
  update(opts:CredstashPutSecretOpts): Promise<any>
  deleteSecret(opts:CredstashDeleteSecretOpts)
  deleteSecrets(opts:CredstashDeleteSecretsOpts)
}

type ObfuscateSecretName = (key:string) => string

type SecretsOpts = {
  credstash: ICredstash
  obfuscateSecretName?: ObfuscateSecretName
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
  private obfuscateSecretName: ObfuscateSecretName
  constructor({ credstash, obfuscateSecretName=_.identity }: SecretsOpts) {
    this.credstash = credstash
    this.obfuscateSecretName = obfuscateSecretName
  }

  public get = async ({ key, version, context = {} }: GetSecretOpts) => {
    const buf = await this.credstash.get({
      name: this.obfuscateSecretName(key),
      context
    })

    return await this._decode(buf)
  }

  public put = async ({ key, value, digest=DIGEST, context = {} }: PutSecretOpts) => {
    const secret = await this._encode(value)
    return await this.credstash.put({
      name: this.obfuscateSecretName(key),
      context,
      digest,
      secret
    })
  }

  public update = async ({ key, value, digest=DIGEST, context = {} }: PutSecretOpts) => {
    const secret = await this._encode(value)
    return await this.credstash.update({
      name: this.obfuscateSecretName(key),
      context,
      digest,
      secret
    })
  }

  public del = async ({ key }) => {
    return await this.credstash.deleteSecrets({ name: key })
  }

  public updateIdentityKeys = async ({ keys }: {
    keys: IPrivKey[]
  }) => {
    return await this.update({
      key: KEYS_SECRET_NAME,
      value: keys,
      context: KEYS_CONTEXT
    })
  }

  public getIdentityKeys = async () => {
    const buf = await this.get({
      key: KEYS_SECRET_NAME,
      context: KEYS_CONTEXT
    })

    return JSON.parse(buf)
  }

  public delIdentityKeys = async () => {
    await this.del({ key: KEYS_SECRET_NAME })
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
