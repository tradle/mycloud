import { parse as parseURL } from 'url'
import { isEqual } from 'lodash'
import yn = require('yn')
import parse = require('yargs-parser')
import buildResource = require('@tradle/build-resource')
import validateResource = require('@tradle/validate-resource')
import models = require('../../../models')
import { toggleProduct } from '../utils'
import Errors = require('../../../errors')
import { ICommand } from '../../../types'

const { parseStub } = validateResource.utils
const description = `add a known provider by url.
Models received from them will be limited to the namespace corresponding to the provider --domain option`

const EXAMPLE = `/addfriend "https://example.com" --domain example.com`
const USAGE = `
${EXAMPLE}

Keep in mind that "domain" will be used to validate the namespace of foreign models.`

export const command:ICommand = {
  name: 'addfriend',
  description,
  examples: [
    '/addfriend tradle.example.com --domain tradle.example.com',
    '/addfriend https://tradle.example.com --domain tradle.example.com',
  ],
  parse: (argsStr:string) => {
    const args = parse(argsStr)
    const { domain } = args
    let url = args._[0]
    if (!url.startsWith('http')) {
      url = 'https://' + url
    }

    const { hostname } = parseURL(url)
    if (!domain) {
      throw new Error(`expected "--domain", for example: ${USAGE}`)
    }

    return { url, domain }
  },
  exec: async function ({ context, req, args }) {
    const { url, domain } = args
    const friend = await context.bot.friends.load({ domain, url })
    const friendStub = buildResource.stub({
      models,
      resource: friend
    })

    const userId = friend._identityPermalink
    const { users } = context.bot
    let user
    try {
      user = await users.get(userId)
    } catch (err) {
      Errors.ignore(err, Errors.NotFound)
      await users.save({ id: userId, friend: friendStub })
    }

    if (user && !isEqual(user.friend, friendStub)) {
      user.friend = friend.permalink
      await users.merge({ id: userId, friend: friendStub })
    }

    await context.sendSimpleMessage({
      req,
      message: `added friend ${friend.name} from ${url}`
    })
  }
}
