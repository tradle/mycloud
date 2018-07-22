import omit from 'lodash/omit'
import { uriEscapePath } from 'aws-sdk/lib/util'
import { TYPE } from '@tradle/constants'
import { randomStringWithLength, sha256 } from './crypto'
import { alphabetical } from './string-utils'
import Errors from './errors'
import Env from './env'
import Logger from './logger'
import { BucketPutOpts, BucketCopyOpts } from './types'
import { S3 } from 'aws-sdk'
import { timeMethods, isPromise, batchProcess, gzip, gunzip, isLocalHost, listIamRoles } from './utils'

const CRR_NAME = 'cross-region-replication-role'
const CRR_POLICY = 'cross-region-replication-policy'
// https://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region
// IMPORTANT: DON'T CHANGE THE ORDER, ONLY APPEND TO THIS LIST!
const REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'ap-south-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-southeast-1',
  'ap-southeast-2',
  'cn-north-1',
  'cn-northwest-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'sa-east-1',
]

// see name restrictions: https://docs.aws.amazon.com/AmazonS3/latest/dev/BucketRestrictions.html
const MAX_BUCKET_NAME_LENGTH = 63
const PUBLIC_BUCKET_RULE_ID = 'MakeItPublic'

export default class S3Utils {
  public s3: S3
  public logger: Logger
  public env: Env
  constructor({ s3, logger, env }: {
    s3: S3,
    logger: Logger,
    env?: Env
  }) {
    this.s3 = s3
    this.logger = logger
    this.env = env
  }

  public get publicFacingHost() {
    return this.env && this.env.TESTING && this.env.S3_PUBLIC_FACING_HOST
  }

  private get replicationAvailable() {
    // localstack has some issues
    return this.iamAvailable
  }

  private get iamAvailable() {
    // localstack doesn't have IAM
    return this.env && !this.env.TESTING
  }

  private get versioningAvailable() {
    return this.env && !this.env.TESTING
  }

  public put = async ({ key, value, bucket, headers = {}, acl }: BucketPutOpts): Promise<S3.Types.PutObjectOutput> => {
    // logger.debug('putting', { key, bucket, type: value[TYPE] })
    const opts: S3.Types.PutObjectRequest = {
      ...headers,
      Bucket: bucket,
      Key: key,
      Body: toStringOrBuf(value)
    }

    if (acl) opts.ACL = acl

    return await this.s3.putObject(opts).promise()
  }

  public gzipAndPut = async (opts) => {
    if (!this._canGzip()) return this.put(opts)

    const { value, headers = {} } = opts
    const compressed = await gzip(toStringOrBuf(value))
    return await this.put({
      ...opts,
      value: compressed,
      headers: {
        ...headers,
        ContentEncoding: 'gzip'
      }
    })
  }

  public get = async ({ key, bucket, ...opts }: {
    key: string,
    bucket: string,
    [x: string]: any
  }): Promise<S3.Types.GetObjectOutput> => {
    const params: S3.Types.GetObjectRequest = {
      Bucket: bucket,
      Key: key,
      ...opts
    }

    try {
      const result = await this.s3.getObject(params).promise()
      // logger.debug('got', { key, bucket, type: result[TYPE] })
      if (result.ContentEncoding === 'gzip') {
        // localstack gunzips but leaves ContentEncoding header
        if (this._canGzip()) {
          result.Body = await gunzip(result.Body)
          delete result.ContentEncoding
        }
      }

      return result
    } catch (err) {
      if (err.code === 'NoSuchKey') {
        throw new Errors.NotFound(`${bucket}/${key}`)
      }

      throw err
    }
  }

  public forEachItemInBucket = async ({ bucket, getBody, map, ...opts }: {
    bucket: string,
    getBody?: boolean,
    map: Function,
    [x: string]: any
  }) => {
    const params: S3.Types.ListObjectsRequest = {
      Bucket: bucket,
      ...opts
    }

    let Marker
    while (true) {
      let { NextMarker, Contents } = await this.s3.listObjects(params).promise()
      if (getBody) {
        await batchProcess({
          data: Contents,
          batchSize: 20,
          processOne: async (item) => {
            const withBody = await this.s3.getObject({ Bucket: bucket, Key: item.Key }).promise()
            let result = map({ ...item, ...withBody })
            if (isPromise(result)) await result
          }
        })
      } else {
        await Promise.all(Contents.map(async (item) => {
          const result = map(item)
          if (isPromise(result)) await result
        }))
      }

      if (!NextMarker) break

      params.Marker = NextMarker
    }
  }

  public listBucket = async ({ bucket, ...opts })
    : Promise<S3.Object[]> => {
    const all = []
    await this.forEachItemInBucket({
      ...opts,
      bucket,
      map: item => all.push(item)
    })

    return all
  }

  public clearBucket = async ({ bucket }) => {
    await this.forEachItemInBucket({
      bucket,
      map: ({ Key }) => this.del({ bucket, key: Key })
    })
  }

  public getCacheable = ({ key, bucket, ttl, parse, ...defaultOpts }: {
    key: string,
    bucket: string,
    ttl: number,
    parse?: (any) => any,
    [x: string]: any
  }) => {
    if (!key) throw new Error('expected "key"')
    if (!bucket) throw new Error('expected "bucket"')
    if (!ttl) throw new Error('expected "ttl"')

    let cached
    let type
    let etag
    let cachedTime = 0
    const invalidateCache = () => {
      cached = undefined
      type = undefined
      etag = undefined
      cachedTime = 0
    }

    const maybeGet = async (opts: any = {}) => {
      let summary = { key, bucket, type }
      if (!opts.force) {
        const age = Date.now() - cachedTime
        if (etag && age < ttl) {
          this.logger.debug('returning cached item', {
            ...summary,
            age,
            ttl: (ttl - age)
          })

          return cached
        }
      }

      opts = {
        ...defaultOpts,
        ...omit(opts, ['force'])
      }

      if (etag) {
        opts.IfNoneMatch = etag
      }

      try {
        cached = await this.get({ key, bucket, ...opts })
      } catch (err) {
        if (err.code === 'NotModified') {
          this.logger.debug('304, returning cached item', summary)
          return cached
        }

        throw err
      }

      if (cached.ETag !== etag) {
        etag = cached.ETag
      }

      if (parse) {
        cached = parse(cached.Body)
      }

      cachedTime = Date.now()
      this.logger.debug('fetched and cached item', summary)

      return cached
    }

    const putAndCache = async ({ value, ...opts }) => {
      if (value == null) throw new Error('expected "value"')

      const result = await this.put({ bucket, key, value, ...defaultOpts, ...opts })
      cached = parse ? value : {
        Body: JSON.stringify(value),
        ...result
      }

      cachedTime = Date.now()
      etag = result.ETag
    }

    return {
      get: maybeGet,
      put: putAndCache,
      invalidateCache
    }
  }

  public putJSON = this.put

  public getJSON = ({ key, bucket }) => {
    return this.get({ key, bucket }).then(({ Body }) => JSON.parse(Body.toString()))
  }

  public head = async ({ key, bucket }) => {
    try {
      return await this.s3.headObject({
        Bucket: bucket,
        Key: key
      }).promise()
    } catch (err) {
      if (err.code === 'NoSuchKey' || err.code === 'NotFound') {
        throw new Errors.NotFound(`${bucket}/${key}`)
      }

      throw err
    }
  }

  public exists = async ({ key, bucket }) => {
    try {
      await this.head({ key, bucket })
      return true
    } catch (err) {
      Errors.ignoreNotFound(err)
      return false
    }
  }

  public del = ({ key, bucket }) => {
    return this.s3.deleteObject({
      Bucket: bucket,
      Key: key
    }).promise()
  }

  public createPresignedUrl = ({ bucket, key }) => {
    const url = this.s3.getSignedUrl('getObject', {
      Bucket: bucket,
      Key: key
    })

    if (this.publicFacingHost) {
      return url.replace(this.s3.config.endpoint, this.publicFacingHost)
    }

    return url
  }

  public createBucket = async ({ bucket }) => {
    return await this.s3.createBucket({ Bucket: bucket }).promise()
  }

  public destroyBucket = async ({ bucket }) => {
    const tasks = [
      () => this.disableReplication({ bucket }),
      () => this.emptyBucket({ bucket }),
      () => this.deleteBucket({ bucket }),
    ]

    this.logger.info('emptying and deleting bucket', { bucket })
    for (const task of tasks) {
      try {
        await task()
      } catch (err) {
        Errors.ignore(err, { code: 'NoSuchBucket' })
      }
    }
  }

  public disableReplication = async ({ bucket }) => {
    if (!this.replicationAvailable) return

    try {
      await this.s3.deleteBucketReplication({ Bucket: bucket }).promise()
    } catch (err) {
      this.logger.error('failed to disable bucket replication', { bucket, error: err.stack })
      // localstack gives some weird error:
      //   'FakeDeleteMarker' object has no attribute 'name'
      if (!this.env.TESTING) throw err
    }
  }

  public deleteBucket = async ({ bucket }) => {
    try {
      await this.s3.deleteBucket({ Bucket: bucket }).promise()
    } catch (err) {
      Errors.ignore(err, { code: 'NoSuchBucket' })
    }
  }

  public getUrlForKey = ({ bucket, key }) => {
    const { host } = this.s3.endpoint
    const encodedKey = uriEscapePath(key)
    if (isLocalHost(host)) {
      return `http://${host}/${bucket}${encodedKey}`
    }

    return `https://${bucket}.s3.amazonaws.com/${encodedKey}`
  }

  public disableEncryption = async ({ bucket }) => {
    this.logger.info(`disabling server-side encryption from bucket ${bucket}`)
    await this.s3.deleteBucketEncryption({ Bucket: bucket }).promise()
  }

  public enableEncryption = async ({ bucket, kmsKeyId }: {
    bucket: string,
    kmsKeyId?: string
  }) => {
    this.logger.info(`enabling server-side encryption for bucket ${bucket}`)
    const params = toEncryptionParams({ bucket, kmsKeyId })
    await this.s3.putBucketEncryption(params).promise()
  }

  public getEncryption = async ({ bucket }) => {
    return await this.s3.getBucketEncryption({ Bucket: bucket }).promise()
  }

  public getLatest = (list:S3.Object[]):S3.Object => {
    let max = 0
    let latest
    for (let metadata of list) {
      let date = new Date(metadata.LastModified).getTime()
      if (date > max) latest = metadata
    }

    return latest
  }

  public makePublic = async ({ bucket }: {
    bucket: string
  }) => {
    this.logger.warn(`making bucket public: ${bucket}`)
    await this.s3.putBucketPolicy({
      Bucket: bucket,
      Policy: `{
        "Version": "2012-10-17",
        "Statement": [{
          "Sid": "${PUBLIC_BUCKET_RULE_ID}",
          "Effect": "Allow",
          "Principal": "*",
          "Action": "s3:GetObject",
          "Resource": "arn:aws:s3:::${bucket}/*"
        }]
      }`
    }).promise()
  }

  public isBucketPublic = async ({ bucket }: {
    bucket: string
  }) => {
    const { Policy } = await this.s3.getBucketPolicy({
      Bucket: bucket
    }).promise()

    const { Statement } = JSON.parse(Policy)
    return Statement.some(({ Sid }) => Sid === PUBLIC_BUCKET_RULE_ID)
  }

  public makeKeysPublic = async ({ bucket, keys }:{
    bucket: string
    keys: string[]
  }) => {
    await this.setPolicyForKeys({ bucket, keys, policy: 'public-read' })
  }

  public setPolicyForKeys = async ({ bucket, keys, policy }: {
    bucket: string
    keys: string[]
    policy: AWS.S3.ObjectCannedACL
  }) => {
    await Promise.all(keys.map(key => this.s3.putObjectAcl({
      Bucket: bucket,
      Key: key,
      ACL: policy
    }).promise()))
  }

  public allowGuestToRead = async ({ bucket, keys }) => {
    const isPublic = await this.isBucketPublic({ bucket })
    if (!isPublic) {
      await this.makeKeysPublic({ bucket, keys })
    }
  }

  public deleteVersions = async ({ bucket, versions }: {
    bucket: string
    versions:AWS.S3.ObjectVersionList
  }) => {
    await this.s3.deleteObjects({
      Bucket: bucket,
      Delete: {
        Objects: versions.map(({ Key, VersionId }) => ({ Key, VersionId }))
      }
    }).promise()
  }

  // copied from empty-aws-bucket
  public emptyBucket = async ({ bucket }: {
    bucket: string
  }) => {
    const { s3, logger } = this
    const Bucket = bucket
    const deleteVersions = versions => this.deleteVersions({ bucket, versions })
    // get the list of all objects in the bucket
    const { Versions } = await s3.listObjectVersions({ Bucket }).promise()

    // before we can delete the bucket, we must delete all versions of all objects
    if (Versions.length > 0) {
      logger.debug(`deleting ${Versions.length} object versions`)
      await deleteVersions(Versions)
    }

    // check for any files marked as deleted previously
    const { DeleteMarkers } = await s3.listObjectVersions({ Bucket }).promise()

    // if the bucket contains delete markers, delete them
    if (DeleteMarkers.length > 0) {
      logger.debug(`deleting ${DeleteMarkers.length} object delete markers`)
      await deleteVersions(DeleteMarkers)
    }

    // if there are any non-versioned contents, delete them too
    const { Contents } = await s3.listObjectsV2({ Bucket }).promise()

    // if the bucket contains delete markers, delete them
    if (Contents.length > 0) {
      logger.debug(`deleting ${Contents.length} objects`)
      await deleteVersions(Contents)
    }
  }

  public createReplicationRole = async ({ iam, source, targets }: {
    iam: AWS.IAM
    source: string
    targets: string[]
  }) => {
    this._ensureIAMAvailable(iam)

    const trustPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            Service: 's3.amazonaws.com'
          },
          Action: 'sts:AssumeRole'
        }
      ]
    }

    const permissionsPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: [
            's3:GetObjectVersionForReplication',
            's3:GetObjectVersionAcl'
          ],
          Resource: [
            `arn:aws:s3:::${source}/*`
          ]
        },
        {
          Effect: 'Allow',
          Action: [
            's3:ListBucket',
            's3:GetReplicationConfiguration'
          ],
          Resource: [
            `arn:aws:s3:::${source}`
          ]
        },
      ].concat(targets.map(target => ({
        Effect: 'Allow',
        Action: [
          's3:ReplicateObject',
          's3:ReplicateDelete'
        ],
        Resource: [`arn:aws:s3:::${target}/*`]
      })))
    }

    const csv = targets.concat(source).sort(alphabetical).join(',')
    const hash = sha256(csv, 'hex').slice(0, 10)
    const description = `for replicating ${source} to: ${targets.join(', ')}`
    const roleName = `${CRR_NAME}-${hash}`
    const role = await this.createRole({
      iam,
      name: roleName,
      description,
      trustPolicy
    })

    const policy = await this.createPolicy({
      iam,
      name: `${CRR_POLICY}-${hash}`,
      description,
      policy: permissionsPolicy
    })

    await iam.attachRolePolicy({
      RoleName: roleName,
      PolicyArn: policy.Arn
    }).promise()

    return {
      role: role.Arn,
      policy: policy.Arn
    }
  }

  public createRegionalBuckets = async ({ bucket, regions, iam, replication }: {
    bucket: string
    regions: string[]
    replication?: boolean
    iam?: AWS.IAM
  }) => {
    const existing = (await this.s3.listBuckets().promise()).Buckets.map(b => b.Name)
    const wontCreate = regions.filter(region => getRegionalBucket({ bucket, region, buckets: existing }))
    if (wontCreate.length) {
      this.logger.warn(`will NOT replicate to ${wontCreate.join(', ')}, as buckets already exist in those regions`)
    }

    const willCreate = regions.filter(r => !wontCreate.includes(r))
    if (!willCreate.length) return []

    const getParams = (region:string):AWS.S3.CreateBucketRequest => ({
      Bucket: S3Utils.getRegionalBucketName({ bucket, region }),
      CreateBucketConfiguration: {
        LocationConstraint: region
      }
    })

    const targets = await Promise.all(willCreate.map(async (region) => {
      const params = getParams(region)
      await this.s3.createBucket(params).promise()

      if (this.versioningAvailable) {
        await this.s3.putBucketVersioning({
          Bucket: params.Bucket,
          VersioningConfiguration: {
            Status: 'Enabled'
          }
        }).promise()
      }

      return params.Bucket
    }))

    if (!replication) return

    this._ensureIAMAvailable(iam)

    const { role } = await this.createReplicationRole({
      iam,
      source: bucket,
      targets
    })

    await Promise.all(targets.map(async target => {
      await this.s3.putBucketReplication({
        Bucket: bucket,
        ReplicationConfiguration: {
          Role: role,
          Rules: [
            {
              Destination: {
                Bucket: target,
                StorageClass: 'STANDARD'
              },
              Prefix: '',
              Status: 'Enabled'
            }
          ]
        }
      }).promise()
    }))

    return targets
  }

  public deleteRegionalBuckets = async ({ bucket, regions, iam }: {
    bucket: string
    regions: string[]
    iam: AWS.IAM
  }) => {
    const existing = (await this.s3.listBuckets().promise()).Buckets.map(b => b.Name)
    const toDel = regions.map(region => S3Utils.getRegionalBucketName({ bucket, region }))
      .filter(regionalName => existing.includes(regionalName))

    if (!toDel.length) return []

    this.logger.info('deleting regional buckets', { buckets: toDel })
    await Promise.all(toDel.map(async name => {
      await this.destroyBucket({ bucket: name })
    }))

    return toDel
  }

  public listBucketWithPrefix = async ({ bucket, prefix }) => {
    return await this.listBucket({ bucket, Prefix: prefix })
  }

  public copyFilesBetweenBuckets = async ({ source, target, keys, prefix, acl }: BucketCopyOpts) => {
    if (!(prefix || keys)) throw new Errors.InvalidInput('expected "keys" or "prefix"')

    if (!keys) {
      const items = await this.listBucketWithPrefix({ bucket: source, prefix })
      keys = items.map(i => i.Key)
    }

    const baseParams:AWS.S3.CopyObjectRequest = {
      Bucket: target,
      CopySource: null,
      Key: null
    }

    if (acl) baseParams.ACL = acl

    await Promise.all(keys.map(async (key) => {
      const params = {
        ...baseParams,
        CopySource: `${source}/${key}`,
        Key: key
      }

      try {
        await this.s3.copyObject(params).promise()
      } catch (err) {
        Errors.ignoreNotFound(err)
        throw new Errors.NotFound(`bucket: "${target}", key: "${key}"`)
      }
    }))
  }

  // public grantReadAccess = async ({ bucket, keys }: {
  //   bucket: string
  //   keys: string[]
  // }) => {
  //   await this.s3.putObjectAcl({
  //     AccessControlPolicy: {
  //       Grants:
  //     }
  //   })
  // }

  public static isRegionalBucketName = (bucket: string) => {
    return REGIONS.some(region => bucket.endsWith(getRegionalBucketSuffix({ bucket, region })))
  }

  public static getRegionalBucketName = ({ bucket, region }) => {
    if (S3Utils.isRegionalBucketName(bucket)) {
      // remove regional suffix
      bucket = bucket.split('-').slice(0, -1).join('-')
    }

    const idx = REGIONS.indexOf(region)
    if (idx === -1) throw new Errors.InvalidInput(`s3 region not supported: ${region}`)

    const suffix = getRegionalBucketSuffix({ bucket, region })
    const name = `${bucket}${suffix}`
    if (name.length > MAX_BUCKET_NAME_LENGTH) {
      const hash = sha256(bucket, 'hex').slice(0, 6)
      // - 1 for '-' char
      const trunc = bucket.slice(0, MAX_BUCKET_NAME_LENGTH - hash.length - suffix.length - 1)
      return `${trunc}-${hash}${suffix}`
    }

    return name
  }

  public getRegionalBucketName = S3Utils.getRegionalBucketName

  public getRegionalBucketForBucket = async ({ bucket, region }: {
    bucket: string
    region: string
  }):Promise<string> => {
    const baseName = this.getBucketBaseName(bucket)
    const buckets = (await this.s3.listBuckets().promise()).Buckets.map(b => b.Name)
    const regional = getRegionalBucket({ bucket, region, buckets })
    if (!regional) {
      throw new Errors.NotFound(`corresponding bucket in ${region} for bucket: ${bucket}`)
    }

    return regional
  }

  public getBucketBaseName = (bucket: string) => bucket.split('-').slice(0, -1).join('-')

  private createPolicy = async ({ iam, name, description, policy }: {
    iam: AWS.IAM
    name: string
    description: string
    policy: any
  }) => {
    this._ensureIAMAvailable(iam)

    try {
      const { Policy } = await iam.createPolicy({
        PolicyName: name,
        PolicyDocument: JSON.stringify(policy),
        Description: description,
      }).promise()

      return Policy
    } catch (err) {
      Errors.ignore(err, { code: 'EntityAlreadyExists' })
      const { Policy } = await iam.getPolicy({
        PolicyArn: `arn:aws:iam::${this.env.AWS_ACCOUNT_ID}:policy/${name}`
      }).promise()

      return Policy
    }
  }

  private createRole = async ({ iam, name, description, trustPolicy }: {
    iam: AWS.IAM
    name: string
    description: string
    trustPolicy: any
  }):Promise<AWS.IAM.Role> => {
    this._ensureIAMAvailable(iam)

    try {
      const { Role } = await iam.createRole({
        RoleName: name,
        AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
        Description: description,
      }).promise()

      return Role
    } catch (err) {
      Errors.ignore(err, { code: 'EntityAlreadyExists' })
      const { Role } = await iam.getRole({
        RoleName: name
      }).promise()

      return Role
    }
  }

  private _canGzip = () => {
    // localstack has some issues
    return !(this.env && this.env.TESTING)
  }

  private _ensureIAMAvailable = (iam: AWS.IAM) => {
    if (!(this.iamAvailable && iam)) {
      throw new Errors.InvalidEnvironment(`IAM not available`)
    }
  }
}

export { S3Utils }
export const createUtils = opts => new S3Utils(opts)

const getRegionalBucket = ({ bucket, region, buckets }) => {
  const regionalName = S3Utils.getRegionalBucketName({ bucket, region })
  if (buckets.includes(regionalName)) return regionalName
}

const toStringOrBuf = (value) => {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value
  if (!value) throw new Error('expected string, Buffer, or stringifiable object')

  return JSON.stringify(value)
}

const toEncryptionParams = ({ bucket, kmsKeyId }):S3.PutBucketEncryptionRequest => {
  const ApplyServerSideEncryptionByDefault:S3.ServerSideEncryptionByDefault = {
    SSEAlgorithm: kmsKeyId ? 'aws:kms' : 'AES256'
  }

  if (kmsKeyId) {
    ApplyServerSideEncryptionByDefault.KMSMasterKeyID = kmsKeyId
  }

  return {
    Bucket: bucket,
    ServerSideEncryptionConfiguration: {
      Rules: [
        {
          ApplyServerSideEncryptionByDefault
        }
      ]
    }
  }
}

const getRegionalBucketSuffix = ({ bucket, region }: {
  bucket: string
  region: string
}) => {
  const idx = REGIONS.indexOf(region)
  if (idx === -1) throw new Errors.InvalidInput(`s3 region not supported: ${region}`)

  return '-' + idx.toString(36)
}
