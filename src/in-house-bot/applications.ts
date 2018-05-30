// @ts-ignore
import Promise from 'bluebird'
import groupBy from 'lodash/groupBy'
import pick from 'lodash/pick'
import omit from 'lodash/omit'
import uniqBy from 'lodash/uniqBy'
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
  Models,
  ApplicationSubmission,
  Logger
} from './types'

import { Resource } from '../resource'

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
const PRUNABLE_FORMS = [
  'tradle.AssignRelationshipManager',
  'tradle.ProductRequest'
]

export class Applications {
  private bot: Bot
  private productsAPI: any
  private logger: Logger
  private get models() {
    return this.bot.models
  }

  constructor({ bot, productsAPI }: {
    bot: Bot
    productsAPI: any
  }) {
    this.bot = bot
    this.productsAPI = productsAPI
    this.logger = bot.logger.sub('applications')
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

  public haveAllFormsBeenVerified = async ({ application }: {
    application: IPBApp
  }) => {
    const unverified = await this.getUnverifiedForms({ application })
    return !unverified.length
  }

  public getUnverifiedForms = async ({ application }) => {
    const formStubs = getCustomerSubmittedForms(application)
    const verifications = await this.getVerifications({ application })
    const verified = verifications.map(verification => parseStub(verification.document))
    return formStubs.filter(stub => {
      const { permalink } = parseStub(stub)
      return !verified.find(form => form.permalink === permalink)
    })
  }

  public getVerifications = async ({ application }: {
    application: IPBApp
  }) => {
    const { verifications=[] } = application
    return await Promise.map(verifications, appSub => this.bot.getResource(appSub.submission))
  }

  public getFormsWithUnissuedVerifications = async({ application }: {
    application: IPBApp
  }) => {
    const promiseBotPermalink = this.bot.getMyPermalink()
    const formStubs = getCustomerSubmittedForms({ forms: application.forms || [] })
    const verifications = await this.getVerifications({ application })
    const botPermalink = await promiseBotPermalink
    const botIssued = verifications.filter(v => v._author === botPermalink)
    const forms = formStubs.filter(stub => {
      const { permalink } = parseStub(stub)
      return !botIssued.some(v => parseStub(v.document).permalink === permalink)
    })

    return {
      forms,
      verifications
    }
  }

  public issueVerifications = async ({ req, user, application, send }: {
    req?: IPBReq
    user: IPBUser
    application: IPBApp
    send?: boolean
  }) => {
    const { forms, verifications } = await this.getFormsWithUnissuedVerifications({ application })
    if (!forms.length) return []

    return await forms.map(formStub => {
      const sources = verifications.filter(v => parseStub(v.document).link === parseStub(formStub).link)
      return this.productsAPI.verify({
        req,
        user,
        application,
        object: formStub,
        verification: { sources },
        send
      })
    })
  }

  public requestEdit = async (opts) => {
    return await this.productsAPI.requestEdit(opts)
  }

  public requestItem = async (opts) => {
    return await this.productsAPI.requestItem(opts)
  }

  public getLatestChecks = async ({ application }: {
    application: IPBApp
  }) => {
    const { checks=[] } = application
    if (!checks.length) return []

    const bodies = await Promise.all(checks
      // get latest version of those checks
      .map(stub => omit(parseStub(stub), '_link'))
      .map(stub => this.bot.getResource(stub)))

    const timeDesc = bodies.slice().sort((a, b) => b._time - a._time)
    return uniqBy(timeDesc, TYPE)
  }

  public haveAllChecksPassed = async ({ application }: {
    application: IPBApp
  }) => {
    const { checks=[] } = application
    if (!checks.length) return true

    const checkResources = await this.getLatestChecks({ application })
    const byAPI:any = groupBy(checkResources, 'provider')
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
    verification = await this.bot.sign(verification)
    const promiseSave = this.bot.save(verification)
    if (application) {
      // we're not sending this verification yet,
      // so we need to create the ApplicationSubmission manually
      await this.createApplicationSubmission({ application, submission: verification })
    }

    this.productsAPI.importVerification({ application, verification })
    this.logger.debug('created verification', {
      verification: verification._permalink,
      application: application._permalink,
      document: verification.document._permalink
    })

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
    await resource.save()
    return signed
  }

  // public getChecks = async (application:IPBApp) => {
  //   const stubs = (application.checks || application.submissions || []).map(appSub => appSub.submission)
  //   return Promise.all(stubs.map(this.bot.getResource))
  // }

  public createApplication = async ({ user, application, req }: {
    req?: IPBReq
    user: IPBUser
    application: ITradleObject
  }) => {
    const res = await this.bot.draft({ type: APPLICATION })
      .set(application)
      .signAndSave()

    const signed = res.toJSON({ virtual: true })
    if (!user.applications) {
      user.applications = []
    }

    this.productsAPI.state.addApplication({ user, application: signed })
    if (!req) {
      await this.bot.users.merge(pick(user, ['id', 'applications']))
    }

    return signed
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

  public getCustomerSubmittedForms = getCustomerSubmittedForms

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

const getCustomerSubmissions = ({ forms }: {
  forms: ApplicationSubmission[]
}) => {
  if (!forms) return []
  return forms.filter(f => !PRUNABLE_FORMS.includes(f.submission[TYPE]))
}

const getCustomerSubmittedForms = ({ forms }: {
  forms: ApplicationSubmission[]
}) => {
  return getCustomerSubmissions({ forms }).map(s => s.submission)
}

const getApplicationWithCustomerSubmittedForms = (application: IPBApp):IPBApp => ({
  ...application,
  forms: getCustomerSubmissions({
    forms: application.forms || []
  })
})
