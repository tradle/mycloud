#!/usr/bin/env node

// download and print my provider info

// #!/bin/sh

// function yaml2json()
// {
//   ruby -ryaml -rjson -e 'puts JSON.pretty_generate(YAML.load(ARGF))' $*
// }

// ENDPOINTS=$(sls info | tail -n +2 | yaml2json | jq .endpoints)

const proc = require('child_process')
const fetch = require('node-fetch')
const YAML = require('js-yaml')
const co = require('co')
const buildResource = require('@tradle/build-resource')
const { PERMALINK } = require('@tradle/constants')

const info = proc.execSync('sls info', {
  cwd: process.cwd()
})
.toString()
.split('\n')

info.shift() // strip first line

const yml = YAML.safeLoad(info.join('\n'))
const { endpoints } = yml
const endpoint = endpoints
  .split(' ')
  .find(str => str.startsWith('https://'))
  .replace(/[/]+$/, '')

co(function* () {
  const url = `${endpoint}/info`
  const res = yield fetch(url)
  if (res.statusCode > 300) {
    throw new Error(res.statusText)
  }

  const info = yield res.json()
  info.endpoint = endpoint
  const { pub } = info.bot
  const { link, permalink } = buildResource.links(pub)
  buildResource.setVirtual(pub, {
    _link: link,
    _permalink: permalink
  })

  process.stdout.write(JSON.stringify(info, null, 2))
})
.catch(err => {
  console.error(err.stack)
  process.exitCode = 1
})
