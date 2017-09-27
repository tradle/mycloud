#!/usr/bin/env node

// const promisify = require('pify')
// const path = require('path')
// const co = require('co').wrap
// const fs = promisify(require('fs'))
// const findit = require('findit')
// ;['../lib', '../test', '../conf'].forEach(co(function* (dir) {
//   dir = path.join(__dirname, dir)
//   // find(dir)
//   const files = yield fs.readdir(dir)
//   files.forEach(co(function* (file) {
//     const src = path.join(dir, file)
//     const dest = path.join(__dirname, '../scripts', dir, file)
//     console.log('copying', src, '->', dest)
//   }))
// }))
