import crypto = require('crypto')
import dotProp = require('dot-prop')
import { TYPE } from '@tradle/constants'
import { DatedValue } from '../../types'
import Logger from '../../logger'

const TERMS_AND_CONDITIONS = 'tradle.TermsAndConditions'
const DATE_PRESENTED_PROP = 'tsAndCsState.datePresented'
const DATE_ACCEPTED_PROP = 'tsAndCsState.dateAccepted'
const CUSTOMER_WAITING = 'tradle.CustomerWaiting'
const SIMPLE_MESSAGE = 'tradle.SimpleMessage'
const YOU_HAVENT_ACCEPTED = `Please accept our Terms and Conditions before we continue :-)`

export const createPlugin = ({
  logger,
  productsAPI,
  termsAndConditions
}: {
  logger: Logger,
  productsAPI: any,
  termsAndConditions: DatedValue
}) => {
  const onmessage = async (req) => {
    const { user, payload, type } = req
    if (user.isFriend) return

    if (type === TERMS_AND_CONDITIONS &&
      payload.termsAndConditions.trim() === termsAndConditions.value.trim()) {
      logger.debug(`updating ${user.id}.${DATE_ACCEPTED_PROP}`)
      dotProp.set(user, DATE_ACCEPTED_PROP, Date.now())
      await productsAPI.sendProductList(req)
      return
    }

    const accepted = await ensureAccepted({
      req,
      termsAndConditions,
      user,
      productsAPI,
      logger
    })

    if (accepted) return

    if (type === SIMPLE_MESSAGE) {
      await productsAPI.send({
        req,
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
  req,
  termsAndConditions,
  user,
  productsAPI,
  logger
}: {
  req?: any,
  termsAndConditions: DatedValue,
  user: any,
  productsAPI: any,
  logger: Logger
}) => {
  const dateAccepted = dotProp.get(user, DATE_ACCEPTED_PROP)
  if (dateAccepted && dateAccepted > termsAndConditions.lastModified) {
    return true
  }

  const datePresented = dotProp.get(user, DATE_PRESENTED_PROP)
  if (!(datePresented && datePresented > termsAndConditions.lastModified)) {
    dotProp.set(user, DATE_PRESENTED_PROP, Date.now())
    logger.debug(`requesting ${user.id} to accept T's and C's`)
    if (!req) {
      req = productsAPI.state.newRequestState({ user })
    }

    await productsAPI.requestItem({
      req,
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
