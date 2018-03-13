import { TYPE, PERMALINK } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { parseStub } from '../utils'
import Errors from '../errors'
import {
  Bot,
  ResourceStub,
  IPBReq,
  IPBApp
} from './types'

interface ICreateCheckOpts {
  props: any
  req?: IPBReq
}

interface IPBJudgeAppOpts {
  req?: IPBReq
  application: string|IPBApp|ResourceStub
  approve?: boolean
}

export class Applications {
  private bot: Bot
  private productsAPI: any
  constructor({ bot, productsAPI }: {
    bot: Bot
    productsAPI: any
  }) {
    this.bot = bot
    this.productsAPI = productsAPI
  }

  public createCheck = async ({ props, req }: ICreateCheckOpts) => {
    const { bot, productsAPI } = this
    const { models } = bot
    const type = props[TYPE]
    if (!(type && props.application)) {
      throw new Error('expected type and "application"')
    }

    const application = await (typeof props.application === 'string'
      ? bot.getResource({ type, permalink: props.application })
      : bot.getResourceByStub(props.application))

    const resource = await bot.createResource({ ...props, application })
    application.checks.push(buildResource.stub({ resource, models }))
    if (!req) {
      await productsAPI.saveNewVersionOfApplication({ application })
    }

    return resource
  }

  public updateCheck = async (opts) => {
    return await this.bot.updateResource(opts)
  }

  public judgeApplication = async ({ req, application, approve }: IPBJudgeAppOpts) => {
    const { bot, productsAPI } = this
    const judge = req && req.user
    application = await productsAPI.getApplication(application) as IPBApp

    const user = await bot.users.get(parseStub(application.applicant).permalink)
    const method = approve ? 'approveApplication' : 'denyApplication'
    try {
      await productsAPI[method]({ req, judge, user, application })
    } catch (err) {
      Errors.ignore(err, Errors.Duplicate)
      throw new Error(`application already has status: ${application.status}`)
    }

    if (req) return

    await productsAPI.saveNewVersionOfApplication({ user, application })
    await bot.users.merge(user)
  }

  public approve = async (opts) => {
    return this.judgeApplication({ ...opts, approve: true })
  }

  public deny = async (opts) => {
    return this.judgeApplication({ ...opts, approve: false })
  }
}
