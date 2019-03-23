require('../env').install()

import test from 'tape'
import buildResource from '@tradle/build-resource'

import * as bizUtils from '../../in-house-bot/utils'
import models from '../../models'
import { ITradleCheck, IConfComponents } from '../../in-house-bot/types'
import { getThirdPartyServiceInfo } from '../../in-house-bot/utils'

const getStatusMessageForCheck = (check: ITradleCheck) =>
  bizUtils.getStatusMessageForCheck({ models, check })
const buildStatus = value =>
  buildResource.enumValue({
    model: models['tradle.Status'],
    value
  })

test('check status message', t => {
  const expected = [
    {
      in: {
        status: 'pass',
        aspects: 'document authenticity'
      },
      out: 'Check passed: document authenticity'
    },
    {
      in: {
        status: 'fail',
        aspects: 'a'
      },
      out: 'Check failed: a'
    },
    {
      in: {
        status: 'error',
        aspects: 'a'
      },
      out: 'Check hit an error: a'
    },
    {
      in: {
        status: 'pending',
        aspects: ['a', 'b', 'c']
      },
      out: 'One or more checks pending: a,b,c'
    }
  ]

  for (const item of expected) {
    t.equal(
      getStatusMessageForCheck({
        aspects: item.in.aspects,
        status: buildStatus(item.in.status)
      }),
      item.out
    )
  }

  t.end()
})

test('getThirdPartyServiceInfo', t => {
  const shared = {
    apiKey: 'xyz',
    apiUrl: 'http://abc.com',
    services: {
      a: {
        enabled: true,
        path: 'a'
      },
      b: {
        enabled: true,
        path: 'b'
      }
    }
  }

  t.same(getThirdPartyServiceInfo({ kycServiceDiscovery: shared }, 'a'), {
    apiKey: shared.apiKey,
    apiUrl: `${shared.apiUrl}/${shared.services.a.path}`
  })

  const overrideForService = {
    ...shared,
    services: {
      ...shared.services,
      b: {
        ...shared.services.b,
        apiUrl: 'http://efg.com'
      }
    }
  }

  t.same(getThirdPartyServiceInfo({ kycServiceDiscovery: overrideForService }, 'b'), {
    apiKey: overrideForService.apiKey,
    apiUrl: overrideForService.services.b.apiUrl
  })

  t.end()
})
