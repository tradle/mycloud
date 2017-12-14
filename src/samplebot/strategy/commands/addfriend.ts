import yn = require('yn')
import parse = require('yargs-parser')
import { toggleProduct } from '../utils'

export default {
  name: 'addfriend',
  description: 'add a known provider by url',
  examples: [
    '/addfriend tradle.example.com',
    '/addfriend https://tradle.example.com',
  ],
  exec: async function ({ context, req, command }) {
    const args = parse(command)
    let url = args._[0]
    if (!url.startsWith('http')) {
      url = 'https://' + url
    }

    const friend = await context.bot.friends.load({ url })
    await context.sendSimpleMessage({
      req,
      message: `added friend ${friend.name} from ${url}`
    })
  }
}
