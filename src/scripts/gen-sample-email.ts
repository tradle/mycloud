#!/usr/bin/env node

import * as Templates from '../in-house-bot/templates'

const template = Templates.email.action({
  action: {
    text: 'Launch MyCloud',
    href: 'launchUrl'
  },
  blocks: [
    { body: 'Hi there,' },
    { body: 'Click below to launch your Tradle MyCloud' }
  ],
  signature: 'Tradle Team',
  twitter: 'tradles'
})

console.log(template)
