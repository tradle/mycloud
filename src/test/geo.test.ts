require('./env').install()

import test from 'tape'
import {
  getAWSRegionByPhoneNumber,
  getAWSRegionByCallingCode,
  parseE164,
  DEFAULT_REGION,
} from '../geo'

test('geo', t => {
  const callingCodeToRegion = {
    // bangladesh
    '880': 'ap-southeast-1',
    '64': 'ap-southeast-2',
    '44': 'eu-west-1',
  }

  for (let callingCode in callingCodeToRegion) {
    t.equal(getAWSRegionByPhoneNumber(callingCode), callingCodeToRegion[callingCode])
    t.same(parseE164(`${callingCode}098765482`), {
      callingCode,
      number: '098765482',
    })
  }

  t.equal(getAWSRegionByCallingCode('98765'), DEFAULT_REGION)

  t.end()
})
