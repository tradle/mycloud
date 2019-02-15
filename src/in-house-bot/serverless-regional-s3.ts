import { regions as REGIONS } from "@tradle/aws-s3-client"
import Errors from "../errors"
import { S3Client, Logger, ClientCache, IAMClient } from "../types"
import { sha256 } from "../crypto"

const MAX_BUCKET_NAME_LENGTH = 63

export interface RegionalS3ClientOpts {
  clients: ClientCache
  s3Client: S3Client
  iamClient: IAMClient
  logger: Logger
  versioningSupported: boolean
  iamSupported: boolean
}

export class RegionalS3Client {
  private get s3() {
    return this.opts.clients.s3
  }
  constructor(private opts: RegionalS3ClientOpts) {}

  public getRegionalBucketName = getRegionalBucketName

  public getRegionalBucketForBucket = async ({
    bucket,
    region
  }: {
    bucket: string
    region: string
  }): Promise<string> => {
    const baseName = this.getBucketBaseName(bucket)
    const buckets = this.listBuckets()
    const regional = getRegionalBucket({ bucket, region, buckets })
    if (!regional) {
      throw new Errors.NotFound(`corresponding bucket in ${region} for bucket: ${bucket}`)
    }

    return regional
  }

  public getBucketBaseName = (bucket: string) =>
    bucket
      .split("-")
      .slice(0, -1)
      .join("-")

  public createRegionalBuckets = async ({
    bucket,
    regions,
    iam,
    replication
  }: {
    bucket: string
    regions: string[]
    replication?: boolean
    iam?: AWS.IAM
  }) => {
    const existing = await this.listBuckets()
    const wontCreate = regions.filter(region =>
      getRegionalBucket({ bucket, region, buckets: existing })
    )
    if (wontCreate.length) {
      this.opts.logger.warn(
        `will NOT replicate to ${wontCreate.join(", ")}, as buckets already exist in those regions`
      )
    }

    const willCreate = regions.filter(r => !wontCreate.includes(r))
    if (!willCreate.length) return []

    const getParams = (region: string): AWS.S3.CreateBucketRequest => ({
      Bucket: getRegionalBucketName({ bucket, region }),
      CreateBucketConfiguration: {
        LocationConstraint: region
      }
    })

    const targets = await Promise.all(
      willCreate.map(async region => {
        const params = getParams(region)
        this.opts.logger.debug("creating regional bucket", {
          bucket: params.Bucket,
          region
        })

        await this.s3.createBucket(params).promise()

        if (this.opts.versioningSupported) {
          await this.s3
            .putBucketVersioning({
              Bucket: params.Bucket,
              VersioningConfiguration: {
                Status: "Enabled"
              }
            })
            .promise()
        }

        return params.Bucket
      })
    )

    if (!replication) return

    if (!this.opts.iamSupported) {
      throw new Errors.InvalidEnvironment(`iam not supported in this environment`)
    }

    const { role } = await this.opts.iamClient.createS3ReplicationRole({
      source: bucket,
      targets
    })

    await Promise.all(
      targets.map(async target => {
        await this.s3
          .putBucketReplication({
            Bucket: bucket,
            ReplicationConfiguration: {
              Role: role,
              Rules: [
                {
                  Destination: {
                    Bucket: target,
                    StorageClass: "STANDARD"
                  },
                  Prefix: "",
                  Status: "Enabled"
                }
              ]
            }
          })
          .promise()
      })
    )

    return targets
  }

  public deleteRegionalBuckets = async ({
    bucket,
    regions
  }: {
    bucket: string
    regions: string[]
  }) => {
    const existing = (await this.s3.listBuckets().promise()).Buckets.map(b => b.Name)
    const toDel = regions
      .map(region => getRegionalBucketName({ bucket, region }))
      .filter(regionalName => existing.includes(regionalName))

    if (!toDel.length) return []

    this.opts.logger.info("deleting regional buckets", { buckets: toDel })
    await Promise.all(
      toDel.map(async name => {
        await this.opts.s3Client.destroyBucket({ bucket: name })
      })
    )

    return toDel
  }

  public listBuckets = async () => {
    return this.opts.s3Client.listBuckets()
  }
}

const getRegionalBucket = ({ bucket, region, buckets }) => {
  const regionalName = getRegionalBucketName({ bucket, region })
  if (buckets.includes(regionalName)) return regionalName
}

const getRegionalBucketSuffix = ({ bucket, region }: { bucket: string; region: string }) => {
  const idx = REGIONS.indexOf(region)
  if (idx === -1) throw new Errors.InvalidInput(`s3 region not supported: ${region}`)

  return "-" + idx.toString(36)
}

export const getRegionalBucketName = ({ bucket, region }) => {
  if (isRegionalBucketName(bucket)) {
    // remove regional suffix
    bucket = bucket
      .split("-")
      .slice(0, -1)
      .join("-")
  }

  const idx = REGIONS.indexOf(region)
  if (idx === -1) throw new Errors.InvalidInput(`s3 region not supported: ${region}`)

  const suffix = getRegionalBucketSuffix({ bucket, region })
  const name = `${bucket}${suffix}`
  if (name.length > MAX_BUCKET_NAME_LENGTH) {
    const hash = sha256(bucket, "hex").slice(0, 6)
    // - 1 for '-' char
    const trunc = bucket.slice(0, MAX_BUCKET_NAME_LENGTH - hash.length - suffix.length - 1)
    return `${trunc}-${hash}${suffix}`
  }

  return name
}

export const isRegionalBucketName = (bucket: string) => {
  return REGIONS.some(region => bucket.endsWith(getRegionalBucketSuffix({ bucket, region })))
}

export const createRegionalS3Client = (opts: RegionalS3ClientOpts) => new RegionalS3Client(opts)
