import validateResource = require('@tradle/validate-resource')
import { PUBLIC_CONF_KEY, PRIVATE_CONF_KEY } from './constants'

export class Conf {
  public privateConfBucket: any
  public publicConfBucket: any
  public privateConf: any
  public publicConf: any
  constructor(bot) {
    this.bot = bot
    const { buckets } = bot.resources
    this.privateConfBucket = buckets.PrivateConf
    this.publicConfBucket = buckets.PublicConf
  }

  public getPrivateConf = () => this.privateConfBucket.getJSON(PRIVATE_CONF_KEY)
  public getPublicConf = () => this.publicConfBucket.getJSON(PUBLIC_CONF_KEY)
  public savePublicConf = async (value:any, reinitializeContainers:boolean=true) => {
    await this.publicConfBucket.put(PUBLIC_CONF_KEY, value)
    if (reinitializeContainers) {
      await this.forceReinitializeContainers()
    }
  }

  public savePrivateConf = async (value:any, reinitializeContainers:boolean=true) => {
    await this.privateConfBucket.put(PRIVATE_CONF_KEY, value)
    if (reinitializeContainers) {
      await this.forceReinitializeContainers()
    }
  }

  public forceReinitializeContainers = () => this.bot.forceReinitializeContainers()

  public setStyle = async (style:any, reinitializeContainers:boolean=true) => {
    await this.bot.promiseReady()
    validateResource({
      models: this.bot.models,
      model: 'tradle.StylesPack',
      resource: style
    })

    const publicConf = await this.getPublicConf()
    publicConf.style = style
    await this.savePublicConf(publicConf, reinitializeContainers)
  }
}

export const createConf = (bot):Conf => new Conf(bot)
