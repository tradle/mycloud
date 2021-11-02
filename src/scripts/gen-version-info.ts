#!/usr/bin/env node

import { exec } from 'child_process'
import { promisify } from 'util'
import { StackUtils } from '../aws/stack-utils'
import { getVar } from '../cli/get-template-var'
import { toSortableTag } from '../utils'

const execAsync = promisify(exec)
const execTrimmed = async (cmd: string) => {
  return (await execAsync(cmd, { encoding: 'utf8' })).stdout.trim()
}

;(async () => {
  const [commitRaw, describeRaw, branch] = await Promise.all([
    execTrimmed(`git rev-parse HEAD`),
    execTrimmed(`git describe --long`),
    execTrimmed(`git symbolic-ref --short HEAD`)
  ])
  const commit = commitRaw.slice(0, 8)
  const { version } = require('../../package.json')
  let [tag, commitsSinceTag] = describeRaw
    .match(/^(.*?)-(\d+)-g([^-]+)$/)
    .slice(1)

  tag = tag.replace(/^v/, '')

  const info = {
    commit,
    commitsSinceTag: parseInt(commitsSinceTag, 10),
    tag,
    sortableTag: toSortableTag(tag),
    branch,
    time: new Date().toISOString(),
    templatesPath: null
  }

  info.templatesPath = StackUtils.getStackLocationKeys({
    ...process.env,
    stage: getVar('stage'),
    versionInfo: info
  }).dir

  process.stdout.write(JSON.stringify(info, null, 2))
})().catch(err => {
  console.error(err.stack)
  process.exit(1)
})
