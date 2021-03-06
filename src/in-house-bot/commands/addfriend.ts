import { parse as parseURL } from 'url'
import parse from 'yargs-parser'
import validateResource from '@tradle/validate-resource'
import { ICommand } from '../types'

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

    return { url, domain }
  },
  async exec ({ commander, req, args }) {
    const { url, domain } = args
    return await commander.friends.load({ url, domain })
  },
  sendResult: async ({ commander, req, args, result }) => {
    await commander.sendSimpleMessage({
      req,
      to: req.user,
      message: `added friend ${result.name} from ${args.url}`
    })
  }
}
