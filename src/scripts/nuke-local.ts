#!/usr/bin/env node

import { getStackName, getRegion, nukeLocalResources } from '../cli/utils'

const stackName = getStackName()
const region = getRegion()
nukeLocalResources({ stackName, region }).catch(err => {
  console.error(err.stack)
  process.exitCode = 1
})
