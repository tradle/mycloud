require('../env').install()

import test from 'tape'
import buildResource from '@tradle/build-resource'

import * as bizUtils from '../../in-house-bot/utils'
import models from '../../models'
import { ITradleCheck } from '../../in-house-bot/types'

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
