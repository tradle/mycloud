#!/usr/bin/env node

// tslint:disable:no-console

import { getStackName, getRegion, genLocalResources } from '../cli/utils'

const stackName = getStackName()
const region = getRegion()
genLocalResources({ stackName, region }).catch(err => {
  console.error(err.stack)
  process.exitCode = 1
})
