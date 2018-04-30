import groupBy from 'lodash/groupBy'
import { TYPE, PERMALINK } from '@tradle/constants'
import buildResource from '@tradle/build-resource'
import { parseStub } from '../utils'
import { isPassedCheck } from './utils'
import Errors from '../errors'
import {
  Bot,
  ResourceStub,
  IPBReq,
  IPBApp,
  ITradleObject,
  IPBUser,
  Models
} from './types'

import { Resource } from '../bot/resource'

interface ICreateCheckOpts {
  props: any
  req?: IPBReq
}

interface IPBJudgeAppOpts {
  req?: IPBReq
  application: string|IPBApp|ResourceStub
  approve?: boolean
}

interface IPropertyInfo {
  name: string
  message?: string
}

const APPLICATION_SUBMISSION = 'tradle.ApplicationSubmission'
const APPLICATION = 'tradle.Application'

export class Applications {
  private bot: Bot
  private productsAPI: any
  private get models() {
    return this.bot.models
  }

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

    return await bot.draft({ type })
      .set(props)
      .signAndSave()
  }

  public updateCheck = async (opts) => {
    const result = await this.bot.updateResource(opts)
    return result.resource
  }

  public judgeApplication = async ({ req, application, approve }: IPBJudgeAppOpts) => {
    const { bot, productsAPI } = this
    const judge = req && req.user
    application = await productsAPI.getApplication(application) as IPBApp

    const user = await this.getApplicantFromApplication(application)
    const method = approve ? 'approveApplication' : 'denyApplication'
    try {
      await productsAPI[method]({ req, judge, user, application })
    } catch (err) {
      Errors.ignore(err, Errors.Duplicate)
      throw new Error(`application already has status: ${application.status}`)
    }

    if (approve) {
      // maybe this should be done asynchronously on resource stream
      // verify unverified
      await this.issueVerifications({ req, user, application, send: true })
    }

    if (req) return

    await this._commitApplicationUpdate({ application })
  }

  public approve = async (opts) => {
    return this.judgeApplication({ ...opts, approve: true })
  }

  public deny = async (opts) => {
    return this.judgeApplication({ ...opts, approve: false })
  }

  public verify = async (opts) => {
    return await this.productsAPI.verify(opts)
  }

  public issueVerifications = async ({ req, user, application, send }: {
    req?: IPBReq
    user: IPBUser
    application: IPBApp
    send?: boolean
  }) => {
    return await this.productsAPI.issueVerifications({ req, user, application, send })
  }

  public requestEdit = async (opts) => {
    return await this.productsAPI.requestEdit(opts)
  }

  public requestItem = async (opts) => {
    return await this.productsAPI.requestItem(opts)
  }

  public haveAllFormsBeenVerified = async ({ application }: {
    application: IPBApp
  }) => {
    return await this.productsAPI.haveAllSubmittedFormsBeenVerified({ application })
  }

  public haveAllChecksPassed = async ({ application }: {
    application: IPBApp
  }) => {
    const { checks=[] } = application
    if (!checks.length) return true

    // get latest version of those checks
    const checkResources = await Promise.all(checks
      .map(appStub => parseStub(appStub.submission))
      .map(stub => this.bot.getResource(stub)))

    const byAPI = groupBy(checkResources, 'provider')
    return Object.keys(byAPI).every(provider => {
      const last = byAPI[provider].pop()
      return isPassedCheck(last)
    })
  }

  public createVerification = async ({ req, application, verification }: {
    verification: ITradleObject
    application?: IPBApp
    req?: IPBReq
  }) => {
    // this.productsAPI.verify({
    //   req,
    //   user: req && req.user,
    //   application,
    //   verification
    // })

    verification = await this.bot.sign(verification)
    const promiseSave = this.bot.save(verification)
    if (application) {
      // we're not sending this verification yet,
      // so we need to create the ApplicationSubmission manually
      await this.createApplicationSubmission({ application, submission: verification })
    }

    this.productsAPI.importVerification({ application, verification })

    await promiseSave
    return verification
  }

  public createApplicationSubmission = async ({ application, submission }: {
    application: IPBApp
    submission: ITradleObject
  }) => {
    const resource = await this.bot.draft({ type: APPLICATION_SUBMISSION })
      .set({
        application,
        submission,
        context: application.context
      })
      .sign()

    const signed = resource.toJSON()
    this.productsAPI.state.addSubmission({ application, submission: signed })
    return signed
  }

  // public getChecks = async (application:IPBApp) => {
  //   const stubs = (application.checks || application.submissions || []).map(appSub => appSub.submission)
  //   return Promise.all(stubs.map(this.bot.getResource))
  // }

  public createApplication = async (application:ITradleObject) => {
    return await this.bot.draft({ type: APPLICATION })
      .set(application)
      .signAndSave()
  }

  private stub = (resource: ITradleObject) => {
    return buildResource.stub({
      models: this.bot.models,
      resource
    })
  }

  private buildResource = () => buildResource({ models: this.models })

  private getApplicantFromApplication = async (application: IPBApp) => {
    return await this.bot.users.get(application.applicant._permalink)
  }

  private _commitApplicationUpdate = async ({ application, user }: {
    application: IPBApp
    user?: IPBUser
  }) => {
    if (!user) {
      user = await this.getApplicantFromApplication(application)
    }

    await this.productsAPI.saveNewVersionOfApplication({ user, application })
    await this.bot.users.save(user)
  }

  // public requestEdit = async (opts: {
  //   req?: IPBReq
  //   user?: IPBUser
  //   application?: IPBApp
  //   item: ITradleObject
  //   properties?: IPropertyInfo[]
  // }) => {
  //   const { req, properties, errors } = opts
  //   let {
  //     item,
  //     user = req.user,
  //     application = req.application,
  //     prefill
  //   } = opts

  //   if (application && !application.context) {
  //     application = this.productsAPI.getApplication(application)
  //   }

  //   const details = {}
  //   if (properties) {

  //   }

  //   const editOpts = { req, user, item, details }

  //   return await this.productsAPI.requestEdit(editOpts)
  // }
  // public listProducts = () => {

  // }
}
