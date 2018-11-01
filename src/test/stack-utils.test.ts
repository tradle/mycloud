
require('./env').install()

// import fs from 'fs'
// import path from 'path'
import test from 'tape'


import { StackUtils } from '../stack-utils'

const virginia = require('./fixtures/cloudformation-template.json')
const sydney = require('./fixtures/cloudformation-template-ap-southeast-2.json')
const yossarian = require('./fixtures/cloudformation-template-yossarian.json')

// test('change region', t => {
//   const hopefullySydney = StackUtils.changeRegion({
//     template: virginia,
//     from: 'us-east-1',
//     to: 'ap-southeast-2',
//   })

//   // fs.writeFileSync(path.resolve(__dirname, '../../src/test/fixtures/cloudformation-template-ap-southeast-2.json'), stableStringify(hopefullySydney, { space: 2 }))
//   // fs.writeFileSync(path.resolve(__dirname, './fixtures/cloudformation-template-ap-southeast-2.json'), stableStringify(hopefullySydney, { space: 2 }))
//   t.same(hopefullySydney, sydney)
//   t.end()
// })

// test('change service name', t => {
//   const hopefullyYossarian = StackUtils.changeServiceName({
//     template: virginia,
//     from: 'tdl-tradle-ltd',
//     to: 'tdl-yossarian-ltd',
//   })

//   // fs.writeFileSync(path.resolve(__dirname, '../../src/test/fixtures/cloudformation-template-yossarian.json'), stableStringify(hopefullyYossarian, { space: 2 }))
//   // fs.writeFileSync(path.resolve(__dirname, './fixtures/cloudformation-template-yossarian.json'), stableStringify(hopefullyYossarian, { space: 2 }))
//   t.same(hopefullyYossarian, yossarian)
//   t.end()
// })
