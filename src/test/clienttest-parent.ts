
import Promise from 'bluebird'
import os from 'os'
import workerFarm from 'worker-farm'
import minimist from 'minimist'

const blopApiUrl = 'https://77om5bovii.execute-api.ap-southeast-1.amazonaws.com/dev'
const defaultArgs = {
  total: 100,
  batchSize: 10,
  url: blopApiUrl,
}

const argv = minimist(process.argv.slice(2), {
  default: defaultArgs
})

const validateArgs = args => {
  const badArg = Object.keys(defaultArgs).find(k => typeof args[k] !== typeof defaultArgs[k])
  if (badArg) {
    throw new Error(`expected number "${badArg}"`)
  }
}

const run = ({ fn, url, total, batchSize }) => new Promise(resolve => {
  let finished = 0
  new Array(total).fill(0).forEach(async (ignore, i) => {
    const opts = {
      url,
      i,
      offset: i * batchSize,
      n: batchSize
    }

    let result
    try {
      result = await fn(opts)
      console.log(`CALL ${i} SUCCEEDED: ${JSON.stringify(result, null, 2)}`)
    } catch (err) {
      console.error(`CALL ${i} FAILED`, err.stack)
    } finally {
      if (++finished === total) {
        workerFarm.end(workers)
        resolve()
      }
    }
  })
})

validateArgs(argv)

const workers:any = workerFarm({
  maxCallsPerWorker: Infinity,
  maxConcurrentWorkers: os.cpus().length,
  maxConcurrentCallsPerWorker: 1,
}, require.resolve('./clienttest-child'), ['testProviderWorker'])

const workIt = Promise.promisify(workers.testProviderWorker)

run({
  ...argv,
  fn: opts => workIt(JSON.stringify(opts)),
})
.then(console.log, console.error)
