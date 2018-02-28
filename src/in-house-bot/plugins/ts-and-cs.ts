import crypto = require('crypto')
import _ = require('lodash')
import { TYPE } from '@tradle/constants'
import { DatedValue } from '../../types'
import Logger from '../../logger'
import { Remediation } from '../remediation'

const TERMS_AND_CONDITIONS = 'tradle.TermsAndConditions'
const DATE_PRESENTED_PROP = 'tsAndCsState.datePresented'
const DATE_ACCEPTED_PROP = 'tsAndCsState.dateAccepted'
const CUSTOMER_WAITING = 'tradle.CustomerWaiting'
const SIMPLE_MESSAGE = 'tradle.SimpleMessage'
const DATA_CLAIM = 'tradle.DataClaim'
const YOU_HAVENT_ACCEPTED = `Please accept our Terms and Conditions before we continue :-)`
const ALLOW_WITHOUT_ACCEPTING = [DATA_CLAIM]
const PRODUCT_REQUEST = 'tradle.ProductRequest'

export const name = 'termsAndConditions'
export const createPlugin = (components: {
  logger: Logger,
  productsAPI: any,
  employeeManager: any,
  remediation?: Remediation,
  termsAndConditions: DatedValue
}) => {
  const onmessage = async (req) => {
    // destructure here, because some may be defined late
    const {
      logger,
      productsAPI,
      employeeManager,
      remediation,
      termsAndConditions
    } = components

    const { user, payload, type, application } = req
    if (user.friend || employeeManager.isEmployee(user)) return

    if (ALLOW_WITHOUT_ACCEPTING.includes(type)) {
      return
    }

    // // HACKERONI START
    // if (type === PRODUCT_REQUEST && remediation.isPrefillClaim(payload)) {
    //   logger.debug('allowing claim through')
    //   return
    // }

    // if (application && application.prefillFromApplication) {
    //   return
    // }

    // HACKERONI END

    if (type === TERMS_AND_CONDITIONS &&
      payload.termsAndConditions.trim() === termsAndConditions.value.trim()) {
      logger.debug(`updating ${user.id}.${DATE_ACCEPTED_PROP}`)
      _.set(user, DATE_ACCEPTED_PROP, Date.now())
      await productsAPI.sendProductList({ req, to: user })
      return
    }

    const accepted = await ensureAccepted({
      termsAndConditions,
      user,
      productsAPI,
      logger
    })

    if (accepted) return

    logger.debug(`preventing further processing, T&C's have not been accepted`)
    if (type === SIMPLE_MESSAGE) {
      await productsAPI.send({
        req,
        to: user,
        object: {
          [TYPE]: SIMPLE_MESSAGE,
          message: YOU_HAVENT_ACCEPTED
        }
      })
    }

    return false // exit middleware
  }

  return {
    onmessage
  }
}

export const ensureAccepted = async ({
  termsAndConditions,
  user,
  productsAPI,
  logger
}: {
  termsAndConditions: DatedValue,
  user: any,
  productsAPI: any,
  logger: Logger
}) => {
  const dateAccepted = _.get(user, DATE_ACCEPTED_PROP)
  if (dateAccepted && dateAccepted > termsAndConditions.lastModified) {
    return true
  }

  const datePresented = _.get(user, DATE_PRESENTED_PROP)
  if (!(datePresented && datePresented > termsAndConditions.lastModified)) {
    _.set(user, DATE_PRESENTED_PROP, Date.now())
    logger.debug(`requesting ${user.id} to accept T's and C's`)
    await productsAPI.requestItem({
      user,
      item: {
        form: 'tradle.TermsAndConditions',
        message: 'Hi! Before we begin this beautiful friendship, please review our **Terms and Conditions**',
        prefill: {
          [TYPE]: 'tradle.TermsAndConditions',
          termsAndConditions: termsAndConditions.value
        }
      }
    })
  }

  logger.debug(`${user.id} has still not accepted T's and C's!`)
  return false
}
