#!/usr/bin/env node

require('source-map-support').install()

import path from 'path'
import fs from 'fs'
import { compileTemplate } from '../cli/utils'

const debug = require('debug')('tradle:sls:compile')
;(async () => {
  const outdir = path.resolve(__dirname, '..', '..')
  const input = path.join(outdir, 'serverless-uncompiled.yml')

  debug('compiling %s', input)
  await compileTemplate({ input, outdir })
})()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
