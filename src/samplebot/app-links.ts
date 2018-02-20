import querystring = require('querystring')
import { WEB_APP_URL, MOBILE_APP_URL } from '../constants'
import { IDeepLink, IApplyForProductDeepLink, IImportDataDeepLink } from './types'

export const getAppLink = ({ path, query, platform }) => {
  const qs = querystring.stringify(query)
  if (platform === 'mobile') {
    return `${MOBILE_APP_URL}/${path}?${qs}`
  }

  return `${WEB_APP_URL}/#/${path}?${qs}`
}

export const getImportDataLink = ({ provider, host, platform, dataHash }: IImportDataDeepLink) => {
  return getAppLink({
    path: 'chat',
    query: {
      permalink: provider,
      url: host,
      dataHash
    },
    platform
  })
}

export const getChatLink = ({ provider, host, platform }: IDeepLink) => {
  return getAppLink({
    path: 'chat',
    query: {
      permalink: provider,
      url: host
    },
    platform
  })
}

export const getApplyForProductLink = ({ provider, host, product, platform }: IApplyForProductDeepLink) => {
  return getAppLink({
    path: 'applyForProduct',
    query: {
      permalink: provider,
      url: host,
      product
    },
    platform
  })
}

export const inferSchemaAndData = ({ provider, host, data }) => {
  const { claimId, product } = data
  if (claimId) {
    return {
      schema: 'ImportData',
      data: { provider, host, dataHash: claimId }
    }
  }

  if (product) {
    return {
      schema: 'ApplyForProduct',
      data: { provider, host, product }
    }
  }

  return {
    schema: 'AddProvider',
    data: { provider, host }
  }
}
