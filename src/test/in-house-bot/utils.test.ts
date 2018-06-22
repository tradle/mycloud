require('../env').install()

import _ from 'lodash'
import Promise from 'bluebird'
import test from 'tape'
import sinon from 'sinon'
import buildResource from '@tradle/build-resource'

import * as bizUtils from '../../in-house-bot/utils'
import models from '../../models'
import { ITradleCheck } from '../../in-house-bot/types'

const getStatusMessageForCheck = (check: ITradleCheck) => bizUtils.getStatusMessageForCheck({ models, check })
const buildStatus = value => buildResource.enumValue({
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
      out: 'Check(s) passed: document authenticity'
    },
    {
      in: {
        status: 'fail',
        aspects: 'a'
      },
      out: 'One or more check(s) failed: a'
    },
    {
      in: {
        status: 'error',
        aspects: 'a'
      },
      out: 'One or more check(s) hit an error: a'
    },
    {
      in: {
        status: 'pending',
        aspects: 'a, b, c'
      },
      out: 'One or more check(s) pending: a, b, c'
    }
  ]

  for (const item of expected) {
    t.equal(getStatusMessageForCheck({
      aspects: item.in.aspects,
      status: buildStatus(item.in.status)
    }), item.out)
  }

  t.end()
})
