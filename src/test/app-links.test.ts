
import test from 'tape'
import {
  toAppSchemeLink,
} from '../app-links'

test('toAppSchemeLink', t => {
  t.equal(toAppSchemeLink('https://link.tradle.io/a?b=c'), 'tradle://a?b=c')
  t.throws(() => toAppSchemeLink('https://blah.tradle.io/a?b=c'), /start with/)
  t.end()
})
