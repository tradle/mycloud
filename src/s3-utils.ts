// import { parse as parseUrl } from "url"
// import omit from "lodash/omit"
// import { uriEscapePath } from "aws-sdk/lib/util"
// import parseS3Url from "amazon-s3-uri"
// import emptyBucket from "empty-aws-bucket"
// import caseless from "caseless"
// import { sha256 } from "./crypto"
// import { alphabetical } from "./string-utils"
// import Errors from "./errors"
// import Env from "./env"
// import Logger from "./logger"
// import { BucketPutOpts, BucketCopyOpts } from "./types"
// import { S3 } from "aws-sdk"
// import { isPromise, batchProcess, gzip, gunzip, isLocalHost, isLocalUrl } from "./utils"

// const CRR_NAME = "cross-region-replication-role"
// const CRR_POLICY = "cross-region-replication-policy"
// // https://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region
// // IMPORTANT: DON'T CHANGE THE ORDER, ONLY APPEND TO THIS LIST!
// const REGIONS = [
//   "us-east-1",
//   "us-east-2",
//   "us-west-1",
//   "us-west-2",
//   "ca-central-1",
//   "ap-south-1",
//   "ap-northeast-1",
//   "ap-northeast-2",
//   "ap-northeast-3",
//   "ap-southeast-1",
//   "ap-southeast-2",
//   "cn-north-1",
//   "cn-northwest-1",
//   "eu-central-1",
//   "eu-west-1",
//   "eu-west-2",
//   "eu-west-3",
//   "sa-east-1"
// ]

// // see name restrictions: https://docs.aws.amazon.com/AmazonS3/latest/dev/BucketRestrictions.html
// const PUBLIC_BUCKET_RULE_ID = "MakeItPublic"
// const LOCAL_S3_PATH_NAME_REGEX = /^\/?([^/]+)\/(.*)/

// type HeaderToS3PutOption = {
//   [x: string]: keyof S3.PutObjectRequest
// }

// const mapToS3PutOption: HeaderToS3PutOption = {
//   ContentType: "ContentType",
//   "content-type": "ContentType",
//   ContentEncoding: "ContentEncoding",
//   "content-encoding": "ContentEncoding"
// }

// const toS3PutOption = caseless(mapToS3PutOption)

// const mapHeadersToS3PutOptions = (headers: any): Partial<S3.PutObjectRequest> => {
//   const putOpts: Partial<S3.PutObjectRequest> = {}
//   for (let name in headers) {
//     let s3Option = toS3PutOption.get(name)
//     if (!s3Option) {
//       throw new Errors.InvalidInput(`unrecognized header: ${name}`)
//     }

//     putOpts[s3Option] = headers[name]
//   }

//   return putOpts
// }

// interface S3ObjWithBody extends S3.Object {
//   Body: S3.Body
// }

// export default class S3Utils {
//   public s3: S3
//   public logger: Logger
//   public env: Env
//   constructor({ s3, logger, env }: { s3: S3; logger: Logger; env?: Env }) {
//     this.s3 = s3
//     this.logger = logger
//     this.env = env
//   }

//   public get publicFacingHost() {
//     return this.isTesting && this.env.S3_PUBLIC_FACING_HOST
//   }

//   private get replicationAvailable() {
//     // localstack has some issues
//     return this.iamAvailable
//   }

//   private get iamAvailable() {
//     // localstack doesn't have IAM
//     return this.env && !this.isTesting
//   }

//   private get versioningAvailable() {
//     return this.env && !this.isTesting
//   }

//   public put = async ({
//     key,
//     value,
//     bucket,
//     headers = {},
//     acl
//   }: BucketPutOpts): Promise<S3.Types.PutObjectOutput> => {
//     // logger.debug('putting', { key, bucket, type: value[TYPE] })
//     const opts: S3.Types.PutObjectRequest = {
//       ...mapHeadersToS3PutOptions(headers),
//       Bucket: bucket,
//       Key: key,
//       Body: toStringOrBuf(value)
//     }

//     if (acl) opts.ACL = acl

//     return await this.s3.putObject(opts).promise()
//   }

//   public gzipAndPut = async opts => {
//     if (!this._canGzip()) return this.put(opts)

//     const { value, headers = {} } = opts
//     const compressed = await gzip(toStringOrBuf(value))
//     return await this.put({
//       ...opts,
//       value: compressed,
//       headers: {
//         ...headers,
//         ContentEncoding: "gzip"
//       }
//     })
//   }

//   public get = async ({
//     key,
//     bucket,
//     ...opts
//   }: {
//     key: string
//     bucket: string
//     [x: string]: any
//   }): Promise<S3.Types.GetObjectOutput> => {
//     const params: S3.Types.GetObjectRequest = {
//       Bucket: bucket,
//       Key: key,
//       ...opts
//     }

//     try {
//       const result = await this.s3.getObject(params).promise()
//       // logger.debug('got', { key, bucket, type: result[TYPE] })
//       if (result.ContentEncoding === "gzip") {
//         // localstack gunzips but leaves ContentEncoding header
//         if (this._canGzip()) {
//           result.Body = await gunzip(result.Body)
//           delete result.ContentEncoding
//         }
//       }

//       return result
//     } catch (err) {
//       if (err.code === "NoSuchKey") {
//         Errors.rethrowAs(err, new Errors.NotFound(`${bucket}/${key}`))
//       }

//       throw err
//     }
//   }

//   public getByUrl = async (url: string) => {
//     const { bucket, key } = S3Utils.parseS3Url(url)
//     const props = { bucket, key }
//     if (key.endsWith(".json") || key.endsWith(".json.gz")) {
//       return this.getJSON(props)
//     }

//     return await this.get(props)
//   }

//   public forEachItemInBucket = async ({
//     bucket,
//     getBody,
//     map,
//     ...opts
//   }: {
//     bucket: string
//     getBody?: boolean
//     map: Function
//     [x: string]: any
//   }) => {
//     const params: S3.Types.ListObjectsV2Request = {
//       Bucket: bucket,
//       ...opts
//     }

//     let Marker
//     while (true) {
//       let { Contents, ContinuationToken } = await this.s3.listObjectsV2(params).promise()
//       if (getBody) {
//         await batchProcess({
//           data: Contents,
//           batchSize: 20,
//           processOne: async item => {
//             const withBody = await this.get({ bucket, key: item.Key })
//             let result = map({ ...item, ...withBody })
//             if (isPromise(result)) await result
//           }
//         })
//       } else {
//         await Promise.all(
//           Contents.map(async item => {
//             const result = map(item)
//             if (isPromise(result)) await result
//           })
//         )
//       }

//       if (!ContinuationToken) break

//       params.ContinuationToken = ContinuationToken
//     }
//   }

//   public listObjects = async (opts): Promise<S3ObjWithBody[]> => {
//     return (await this.listBucket({ ...opts, getBody: true })) as S3ObjWithBody[]
//   }

//   public listObjectsWithKeyPrefix = async (opts): Promise<S3ObjWithBody[]> => {
//     return (await this.listBucketWithPrefix({ ...opts, getBody: true })) as S3ObjWithBody[]
//   }

//   public listBucket = async ({ bucket, ...opts }): Promise<S3.Object[]> => {
//     const all = []
//     await this.forEachItemInBucket({
//       ...opts,
//       bucket,
//       map: item => all.push(item)
//     })

//     return all
//   }

//   public clearBucket = async ({ bucket }) => {
//     await this.forEachItemInBucket({
//       bucket,
//       map: ({ Key }) => this.del({ bucket, key: Key })
//     })
//   }

//   public getCacheable = ({
//     key,
//     bucket,
//     ttl,
//     parse,
//     ...defaultOpts
//   }: {
//     key: string
//     bucket: string
//     ttl: number
//     parse?: (any) => any
//     [x: string]: any
//   }) => {
//     if (!key) throw new Error('expected "key"')
//     if (!bucket) throw new Error('expected "bucket"')
//     if (!ttl) throw new Error('expected "ttl"')

//     let cached
//     let type
//     let etag
//     let cachedTime = 0
//     const invalidateCache = () => {
//       cached = undefined
//       type = undefined
//       etag = undefined
//       cachedTime = 0
//     }

//     const maybeGet = async (opts: any = {}) => {
//       let summary = { key, bucket, type }
//       if (!opts.force) {
//         const age = Date.now() - cachedTime
//         if (etag && age < ttl) {
//           this.logger.debug("returning cached item", {
//             ...summary,
//             age,
//             ttl: ttl - age
//           })

//           return cached
//         }
//       }

//       opts = {
//         ...defaultOpts,
//         ...omit(opts, ["force"])
//       }

//       if (etag) {
//         opts.IfNoneMatch = etag
//       }

//       try {
//         cached = await this.get({ key, bucket, ...opts })
//       } catch (err) {
//         if (err.code === "NotModified") {
//           this.logger.debug("304, returning cached item", summary)
//           return cached
//         }

//         throw err
//       }

//       if (cached.ETag !== etag) {
//         etag = cached.ETag
//       }

//       if (parse) {
//         cached = parse(cached.Body)
//       }

//       cachedTime = Date.now()
//       this.logger.debug("fetched and cached item", summary)

//       return cached
//     }

//     const putAndCache = async ({ value, ...opts }) => {
//       if (value == null) throw new Error('expected "value"')

//       const result = await this.put({ bucket, key, value, ...defaultOpts, ...opts })
//       cached = parse
//         ? value
//         : {
//             Body: JSON.stringify(value),
//             ...result
//           }

//       cachedTime = Date.now()
//       etag = result.ETag
//     }

//     return {
//       get: maybeGet,
//       put: putAndCache,
//       invalidateCache
//     }
//   }

//   public putJSON = this.put

//   public getJSON = ({ key, bucket }) => {
//     return this.get({ key, bucket }).then(({ Body }) => JSON.parse(Body.toString()))
//   }

//   public head = async ({ key, bucket }) => {
//     try {
//       return await this.s3
//         .headObject({
//           Bucket: bucket,
//           Key: key
//         })
//         .promise()
//     } catch (err) {
//       if (err.code === "NoSuchKey" || err.code === "NotFound") {
//         Errors.rethrowAs(err, new Errors.NotFound(`${bucket}/${key}`))
//       }

//       throw err
//     }
//   }

//   public exists = async ({ key, bucket }) => {
//     try {
//       await this.head({ key, bucket })
//       return true
//     } catch (err) {
//       Errors.ignoreNotFound(err)
//       return false
//     }
//   }

//   public del = ({ key, bucket }) => {
//     return this.s3
//       .deleteObject({
//         Bucket: bucket,
//         Key: key
//       })
//       .promise()
//   }

//   public createPresignedUrl = ({ bucket, key }) => {
//     const url = this.s3.getSignedUrl("getObject", {
//       Bucket: bucket,
//       Key: key
//     })

//     if (this.publicFacingHost) {
//       return url.replace(this.s3.config.endpoint, this.publicFacingHost)
//     }

//     return url
//   }

//   public createBucket = async ({ bucket }) => {
//     return await this.s3.createBucket({ Bucket: bucket }).promise()
//   }

//   public destroyBucket = async ({ bucket }) => {
//     const tasks = [
//       () => this.disableReplication({ bucket }),
//       () => this.emptyBucket({ bucket }),
//       () => this.deleteBucket({ bucket })
//     ]

//     this.logger.info("emptying and deleting bucket", { bucket })
//     for (const task of tasks) {
//       try {
//         await task()
//       } catch (err) {
//         Errors.ignore(err, { code: "NoSuchBucket" })
//       }
//     }
//   }

//   public disableReplication = async ({ bucket }) => {
//     if (!this.replicationAvailable) return

//     try {
//       await this.s3.deleteBucketReplication({ Bucket: bucket }).promise()
//     } catch (err) {
//       this.logger.error("failed to disable bucket replication", { bucket, error: err.stack })
//       // localstack gives some weird error:
//       //   'FakeDeleteMarker' object has no attribute 'name'
//       if (!this.isTesting) throw err
//     }
//   }

//   public deleteBucket = async ({ bucket }) => {
//     try {
//       await this.s3.deleteBucket({ Bucket: bucket }).promise()
//     } catch (err) {
//       Errors.ignore(err, { code: "NoSuchBucket" })
//     }
//   }

//   public getUrlForKey = ({ bucket, key }) => {
//     const { host } = this.s3.endpoint
//     const encodedKey = uriEscapePath(key)
//     if (isLocalHost(host)) {
//       return `http://${host}/${bucket}${encodedKey}`
//     }

//     return `https://${bucket}.s3.amazonaws.com/${encodedKey}`
//   }

//   public disableEncryption = async ({ bucket }) => {
//     this.logger.info(`disabling server-side encryption from bucket ${bucket}`)
//     await this.s3.deleteBucketEncryption({ Bucket: bucket }).promise()
//   }

//   public enableEncryption = async ({ bucket, kmsKeyId }: { bucket: string; kmsKeyId?: string }) => {
//     this.logger.info(`enabling server-side encryption for bucket ${bucket}`)
//     const params = toEncryptionParams({ bucket, kmsKeyId })
//     await this.s3.putBucketEncryption(params).promise()
//   }

//   public getEncryption = async ({ bucket }) => {
//     return await this.s3.getBucketEncryption({ Bucket: bucket }).promise()
//   }

//   public getLatest = (list: S3.Object[]): S3.Object => {
//     let max = 0
//     let latest
//     for (let metadata of list) {
//       let date = new Date(metadata.LastModified).getTime()
//       if (date > max) latest = metadata
//     }

//     return latest
//   }

//   public makePublic = async ({ bucket }: { bucket: string }) => {
//     this.logger.warn(`making bucket public: ${bucket}`)
//     await this.s3
//       .putBucketPolicy({
//         Bucket: bucket,
//         Policy: `{
//         "Version": "2012-10-17",
//         "Statement": [{
//           "Sid": "${PUBLIC_BUCKET_RULE_ID}",
//           "Effect": "Allow",
//           "Principal": "*",
//           "Action": "s3:GetObject",
//           "Resource": "arn:aws:s3:::${bucket}/*"
//         }]
//       }`
//       })
//       .promise()
//   }

//   public isBucketPublic = async ({ bucket }: { bucket: string }) => {
//     let result: AWS.S3.GetBucketPolicyOutput
//     try {
//       result = await this.s3
//         .getBucketPolicy({
//           Bucket: bucket
//         })
//         .promise()
//     } catch (err) {
//       Errors.ignoreNotFound(err)
//       return false
//     }

//     const { Statement } = JSON.parse(result.Policy)
//     return Statement.some(({ Sid }) => Sid === PUBLIC_BUCKET_RULE_ID)
//   }

//   public makeKeysPublic = async ({ bucket, keys }: { bucket: string; keys: string[] }) => {
//     await this.setPolicyForKeys({ bucket, keys, policy: "public-read" })
//   }

//   public setPolicyForKeys = async ({
//     bucket,
//     keys,
//     policy
//   }: {
//     bucket: string
//     keys: string[]
//     policy: AWS.S3.ObjectCannedACL
//   }) => {
//     await Promise.all(
//       keys.map(key =>
//         this.s3
//           .putObjectAcl({
//             Bucket: bucket,
//             Key: key,
//             ACL: policy
//           })
//           .promise()
//       )
//     )
//   }

//   public allowGuestToRead = async ({ bucket, keys }) => {
//     const isPublic = await this.isBucketPublic({ bucket })
//     if (!isPublic) {
//       await this.makeKeysPublic({ bucket, keys })
//     }
//   }

//   public deleteVersions = async ({
//     bucket,
//     versions
//   }: {
//     bucket: string
//     versions: AWS.S3.ObjectVersionList
//   }) => {
//     await this.s3
//       .deleteObjects({
//         Bucket: bucket,
//         Delete: {
//           Objects: versions.map(({ Key, VersionId }) => ({ Key, VersionId }))
//         }
//       })
//       .promise()
//   }

//   // copied from empty-aws-bucket
//   public emptyBucket = async ({ bucket }: { bucket: string }) => {
//     const { s3 } = this
//     return emptyBucket({ s3, bucket })
//   }

//   public createReplicationRole = async ({
//     iam,
//     source,
//     targets
//   }: {
//     iam: AWS.IAM
//     source: string
//     targets: string[]
//   }) => {
//     this._ensureIAMAvailable(iam)

//     const trustPolicy = {
//       Version: "2012-10-17",
//       Statement: [
//         {
//           Effect: "Allow",
//           Principal: {
//             Service: "s3.amazonaws.com"
//           },
//           Action: "sts:AssumeRole"
//         }
//       ]
//     }

//     const permissionsPolicy = {
//       Version: "2012-10-17",
//       Statement: [
//         {
//           Effect: "Allow",
//           Action: ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl"],
//           Resource: [`arn:aws:s3:::${source}/*`]
//         },
//         {
//           Effect: "Allow",
//           Action: ["s3:ListBucket", "s3:GetReplicationConfiguration"],
//           Resource: [`arn:aws:s3:::${source}`]
//         }
//       ].concat(
//         targets.map(target => ({
//           Effect: "Allow",
//           Action: ["s3:ReplicateObject", "s3:ReplicateDelete"],
//           Resource: [`arn:aws:s3:::${target}/*`]
//         }))
//       )
//     }

//     const csv = targets
//       .concat(source)
//       .sort(alphabetical)
//       .join(",")
//     const hash = sha256(csv, "hex").slice(0, 10)
//     const description = `for replicating ${source} to: ${targets.join(", ")}`
//     const roleName = `${CRR_NAME}-${hash}`
//     const role = await this.createRole({
//       iam,
//       name: roleName,
//       description,
//       trustPolicy
//     })

//     const policy = await this.createPolicy({
//       iam,
//       name: `${CRR_POLICY}-${hash}`,
//       description,
//       policy: permissionsPolicy
//     })

//     await iam
//       .attachRolePolicy({
//         RoleName: roleName,
//         PolicyArn: policy.Arn
//       })
//       .promise()

//     return {
//       role: role.Arn,
//       policy: policy.Arn
//     }
//   }
//   public listBucketWithPrefix = async ({ bucket, prefix, ...opts }) => {
//     return await this.listBucket({ bucket, Prefix: prefix, ...opts })
//   }

//   public copyFilesBetweenBuckets = async ({
//     source,
//     target,
//     keys,
//     prefix,
//     acl
//   }: BucketCopyOpts) => {
//     if (!(prefix || keys)) throw new Errors.InvalidInput('expected "keys" or "prefix"')

//     if (!keys) {
//       const items = await this.listBucketWithPrefix({ bucket: source, prefix })
//       keys = items.map(i => i.Key)
//     }

//     const baseParams: AWS.S3.CopyObjectRequest = {
//       Bucket: target,
//       CopySource: null,
//       Key: null
//     }

//     if (acl) baseParams.ACL = acl

//     await Promise.all(
//       keys.map(async key => {
//         const params = {
//           ...baseParams,
//           CopySource: `${source}/${key}`,
//           Key: key
//         }

//         try {
//           await this.s3.copyObject(params).promise()
//         } catch (err) {
//           Errors.ignoreNotFound(err)
//           Errors.rethrowAs(err, new Errors.NotFound(`bucket: "${target}", key: "${key}"`))
//         }
//       })
//     )
//   }

//   // public grantReadAccess = async ({ bucket, keys }: {
//   //   bucket: string
//   //   keys: string[]
//   // }) => {
//   //   await this.s3.putObjectAcl({
//   //     AccessControlPolicy: {
//   //       Grants:
//   //     }
//   //   })
//   // }

//   public static parseS3Url = url => {
//     try {
//       return parseS3Url(url)
//     } catch (err) {
//       if (!isLocalUrl(url)) {
//         Errors.rethrowAs(err, new Errors.InvalidInput(`invalid s3 url: ${url}`))
//       }
//     }

//     const parsed = parseUrl(url)
//     const { pathname = "" } = parsed
//     const match = pathname.match(LOCAL_S3_PATH_NAME_REGEX)
//     if (!match) return

//     const [bucket, key] = match.slice(1)
//     if (bucket && key) return { bucket, key, isPathStyle: true }

//     throw new Errors.InvalidInput(`invalid s3 url: ${url}`)
//   }

//   public parseS3Url = S3Utils.parseS3Url

//   private createPolicy = async ({
//     iam,
//     name,
//     description,
//     policy
//   }: {
//     iam: AWS.IAM
//     name: string
//     description: string
//     policy: any
//   }) => {
//     this._ensureIAMAvailable(iam)

//     try {
//       const { Policy } = await iam
//         .createPolicy({
//           PolicyName: name,
//           PolicyDocument: JSON.stringify(policy),
//           Description: description
//         })
//         .promise()

//       return Policy
//     } catch (err) {
//       Errors.ignore(err, { code: "EntityAlreadyExists" })
//       const { Policy } = await iam
//         .getPolicy({
//           PolicyArn: `arn:aws:iam::${this.env.AWS_ACCOUNT_ID}:policy/${name}`
//         })
//         .promise()

//       return Policy
//     }
//   }

//   private createRole = async ({
//     iam,
//     name,
//     description,
//     trustPolicy
//   }: {
//     iam: AWS.IAM
//     name: string
//     description: string
//     trustPolicy: any
//   }): Promise<AWS.IAM.Role> => {
//     this._ensureIAMAvailable(iam)

//     try {
//       const { Role } = await iam
//         .createRole({
//           RoleName: name,
//           AssumeRolePolicyDocument: JSON.stringify(trustPolicy),
//           Description: description
//         })
//         .promise()

//       return Role
//     } catch (err) {
//       Errors.ignore(err, { code: "EntityAlreadyExists" })
//       const { Role } = await iam
//         .getRole({
//           RoleName: name
//         })
//         .promise()

//       return Role
//     }
//   }

//   private _canGzip = () => {
//     // localstack has some issues
//     return !this.isTesting
//   }

//   private _ensureIAMAvailable = (iam: AWS.IAM) => {
//     if (!(this.iamAvailable && iam)) {
//       throw new Errors.InvalidEnvironment(`IAM not available`)
//     }
//   }

//   private get isTesting() {
//     return this.env && this.env.IS_TESTING
//   }
// }

// export { S3Utils }
// export const createUtils = opts => new S3Utils(opts)

// const toStringOrBuf = value => {
//   if (typeof value === "string") return value
//   if (Buffer.isBuffer(value)) return value
//   if (!value) throw new Error("expected string, Buffer, or stringifiable object")

//   return JSON.stringify(value)
// }

// const toEncryptionParams = ({ bucket, kmsKeyId }): S3.PutBucketEncryptionRequest => {
//   const ApplyServerSideEncryptionByDefault: S3.ServerSideEncryptionByDefault = {
//     SSEAlgorithm: kmsKeyId ? "aws:kms" : "AES256"
//   }

//   if (kmsKeyId) {
//     ApplyServerSideEncryptionByDefault.KMSMasterKeyID = kmsKeyId
//   }

//   return {
//     Bucket: bucket,
//     ServerSideEncryptionConfiguration: {
//       Rules: [
//         {
//           ApplyServerSideEncryptionByDefault
//         }
//       ]
//     }
//   }
// }
