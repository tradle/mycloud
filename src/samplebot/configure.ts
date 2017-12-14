import deepEqual = require('deep-equal')
import validateResource = require('@tradle/validate-resource')
import { PUBLIC_CONF_KEY, PRIVATE_CONF_KEY, CUSTOM_MODELS_KEY, STYLES_KEY } from './constants'
import serverlessYml = require('../cli/serverless-yml')
import Errors = require('../errors')
import { allSettled } from '../utils'

const { reinitializeOnConfChanged } = serverlessYml.custom

export class Conf {
  public bot: any
  public privateConfBucket: any
  public publicConfBucket: any
  public publicConf: any
  public privateConf: any
  public customModels: any
  public styles: any
  constructor(bot) {
    this.bot = bot
    const { buckets } = bot
    this.privateConfBucket = buckets.PrivateConf
    this.publicConfBucket = buckets.PublicConf

    this.publicConf = this.publicConfBucket.getCacheable({
      ttl: 60000,
      key: PUBLIC_CONF_KEY,
      parse: JSON.parse.bind(JSON)
    })

    this.privateConf = this.privateConfBucket.getCacheable({
      ttl: 60000,
      key: PRIVATE_CONF_KEY,
      parse: JSON.parse.bind(JSON)
    })

    this.customModels = this.privateConfBucket.getCacheable({
      ttl: 60000,
      key: CUSTOM_MODELS_KEY,
      parse: JSON.parse.bind(JSON)
    })

    this.styles = this.privateConfBucket.getCacheable({
      ttl: 60000,
      key: STYLES_KEY,
      parse: JSON.parse.bind(JSON)
    })
  }

  public get = async (forceFetch?:boolean) => {
    const results = await allSettled([
      this.getPrivateConf(),
      this.getPublicConf(),
      this.getStyles(),
      this.getCustomModels()
    ])

    const [
      privateConf,
      publicConf,
      styles,
      customModels
    ] = results.map(r => value)

    return {
      privateConf,
      publicConf,
      styles,
      customModels
    }
  }

  public getCustomModels = async (forceFetch?:boolean) => {
    return this.customModels.get({ force: forceFetch })
  }

  public getStyles = async (forceFetch?:boolean) => {
    return this.styles.get({ force: forceFetch })
  }

  public getPrivateConf = async (forceFetch?:boolean) => {
    return this.privateConf.get({ force: forceFetch })
  }

  public getPublicConf = async (forceFetch?:boolean) => {
    return this.publicConf.get({ force: forceFetch })
  }

  public savePublicConf = async (value:any, reinitializeContainers:boolean=true) => {
    await this.putIfDifferent({
      bucket: this.publicConfBucket,
      key: PUBLIC_CONF_KEY,
      value,
      reinitializeContainers
    })
  }

  public savePrivateConf = async (value:any, reinitializeContainers:boolean=true) => {
    await this.putIfDifferent({
      bucket: this.privateConfBucket,
      key: PRIVATE_CONF_KEY,
      value,
      reinitializeContainers
    })
  }

  public forceReinitializeContainers = () =>
    this.bot.forceReinitializeContainers(reinitializeOnConfChanged)

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

  private putIfDifferent = async ({ bucket, key, value, reinitializeContainers }) => {
    const willPut = await hasDifferentValue({ bucket, key, value })

    if (willPut) {
      await bucket.put(key, value)
      if (reinitializeContainers) {
        await this.forceReinitializeContainers()
      }
    }
  }
}

export const createConf = (bot):Conf => new Conf(bot)

const hasDifferentValue = async ({ bucket, key, value }) => {
  try {
    const current = await bucket.get(key)
    return !deepEqual(current, value)
  } catch (err) {
    Errors.ignore(err, Errors.NotFound)
    return true
  }
}
