import {
  Env,
  Bot,
  Bucket,
  IPluginOpts,
  IDeploymentOpts
} from './types'

export class Deployment {
  private bot: Bot
  private env: Env
  private pubConfBucket: Bucket
  private deploymentBucket: Bucket
  constructor({ bot }: { bot: Bot }) {
    this.bot = bot
    this.env = bot.env
    this.pubConfBucket = bot.buckets.PublicConf
    this.deploymentBucket = bot.buckets.ServerlessDeployment
  }

  // const onForm = async ({ bot, user, type, wrapper, currentApplication }) => {
  //   if (type !== CONFIG_FORM) return
  //   if (!currentApplication || currentApplication.requestFor !== DEPLOYMENT_PRODUCT) return

  //   const { object } = wrapper.payload
  //   const { domain } = object
  //   try {
  //     await getLogo({ domain })
  //   } catch (err) {
  //     const message = `couldn't process your logo!`
  //     await bot.requestEdit({
  //       user,
  //       item: object,
  //       message,
  //       errors: [
  //         {
  //           name: 'domain',
  //           error: message
  //         }
  //       ]
  //     })
  //   }
  // }

  public getLaunchUrl = async (parameters: IDeploymentOpts) => {
    const templateURL = await this.bot.stackUtils.createPublicTemplate(template => {
      return this.customizeTemplate({ template, parameters })
    })

    return this.bot.stackUtils.getLaunchStackUrl({ templateURL })
  }

  public customizeTemplate = ({ template, parameters }) => {
    let { name, domain, scale } = parameters

    if (!(name && domain)) throw new Error('expected "name" and "domain"')

    template.Description = `MyCloud, by Tradle`
    domain = normalizeDomain(domain)

    const namespace = domain.split('.').reverse().join('.')
    const { Resources } = template
    Resources.Initialize.Properties.ProviderConf.org = { name, domain }

    const deploymentBucketId = this.bot.buckets.ServerlessDeployment.id
    for (let key in Resources) {
      let Resource = Resources[key]
      let { Type } = Resource
      switch (Type) {
      case 'AWS::Lambda::Function':
        // resolve Code bucket
        Resource.Properties.Code.S3Bucket = deploymentBucketId
        break
      default:
        break
      }
    }

    // write template to s3, return link
    return template
  }
}

export const createDeployment = (opts:IPluginOpts) => new Deployment(opts)

const scaleTable = ({ table, scale }) => {
  let { ProvisionedThroughput } = table.Properties
  ProvisionedThroughput.ReadCapacityUnits *= scale
  ProvisionedThroughput.WriteCapacityUnits *= scale
  const { GlobalSecondaryIndexes=[] } = table
  GlobalSecondaryIndexes.forEach(index => scaleTable({ table: index, scale }))
}

const normalizeDomain = (domain:string) => {
  return domain.replace(/^(?:https?:\/\/)?(?:www\.)?/, '')
}
