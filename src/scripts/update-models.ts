import proc from 'child_process'
const pkg = require('../../package.json')
const modules = process.argv.slice(2)

const modelsDeps = Object.keys(pkg.dependencies)
  .filter(p => !modules.length || modules.indexOf(p) !== -1)
  .filter(p => /\@tradle\/.*models.*/.test(p) && /models/.test(pkg.dependencies[p]))
  .map(p => pkg.dependencies[p])

if (!modelsDeps.length) {
  throw new Error('nothing to install')
}

const installLine = `npm i --save ${modelsDeps.join(' ')} && npm run reshrink`
console.log(`running: ${installLine}`)

proc.execSync(installLine, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit'
})
