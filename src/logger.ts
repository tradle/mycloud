// inspired by
// http://theburningmonk.com/2017/09/capture-and-forward-correlation-ids-through-different-lambda-event-sources/

import isEmpty from 'lodash/isEmpty'
import _stringifySafe from 'json-stringify-safe'

const stringifySafe = obj => {
  try {
    return _stringifySafe(obj)
  } catch (err) {
    return `failed to stringify object: ${err.stack}`
  }
}

export enum Level {
  ERROR=0,
  WARN=1,
  INFO=2,
  VERBOSE=3,
  DEBUG=4,
  SILLY=5,
  RIDICULOUS=6
}

const HIGHEST_LEVEL = Level.RIDICULOUS

// const getLevelName = level => {
//   for (let name in Level) {
//     if (Level[name] === level) return name
//   }

//   throw new Error(`invalid level: ${level}`)
// }

const FORMATS = [
  'json',
  'text'
]

const METHODS = {
  error: 'error',
  warn: 'warn',
  info: 'info',
  verbose: 'info',
  debug: 'info',
  silly: 'info',
  ridiculous: 'info',
}

const COLORS = {
  ERROR: 'red',
  WARN: 'yellow',
  INFO: 'blue',
  VERBOSE: 'cyan',
  SILLY: 'pink'
}

export type Writer = {
  log: Function
  [x: string]: any
}

export type LoggerConf = {
  namespace?:string
  context?:any
  level?:number
  writer?:Writer
  outputFormat?:string
}

type CompareResult = 1|-1|0

export default class Logger {
  public namespace:string
  public context:any
  public level:Level
  public subloggers:Logger[]
  private writer:Writer
  private outputFormat:string
  private conf:LoggerConf
  // private get levelName () {
  //   return getLevelName(this.level)
  // }

  public static compareSeverity = (a: Level, b: Level):CompareResult => {
    if (a === b) return 0

    // return -1 if a is less severe, 1 if a is more severe
    return a < b ? 1 : -1
  }

  constructor (conf:LoggerConf|string) {
    if (typeof conf === 'string') {
      conf = { namespace: conf }
    }

    let {
      namespace='',
      context={},
      level=Level.DEBUG,
      writer=global.console,
      outputFormat='json'
    } = conf

    if (level < 0) level = 0
    else if (level > HIGHEST_LEVEL) level = HIGHEST_LEVEL

    this.conf = conf
    this.namespace = namespace
    this.context = context
    this.level = level

    this.writer = writer
    this.outputFormat = outputFormat
    if (!FORMATS.includes(outputFormat)) {
      throw new Error(`expected outputFormat to be one of: ${FORMATS.join(', ')}`)
    }

    this.subloggers = []
  }

  public setWriter = (writer:Writer, propagateToSubWriters?:boolean) => {
    this.writer = writer
    if (propagateToSubWriters) {
      this.subloggers.forEach(logger => logger.setWriter(writer, propagateToSubWriters))
    }
  }

  public setContext = (value:any) => {
    this.context = value
    this.subloggers.forEach(logger => logger.setContext(this.context))
  }

  public ridiculous = (msg:string, details?:any) => this.log('RIDICULOUS', msg, details)
  public silly = (msg:string, details?:any) => this.log('SILLY', msg, details)
  public debug = (msg:string, details?:any) => this.log('DEBUG', msg, details)
  public info = (msg:string, details?:any) => this.log('INFO', msg, details)
  public warn = (msg:string, details?:any) => this.log('WARN', msg, details)
  public error = (msg:string, details?:any) => this.log('ERROR', msg, details)
  public sub = (conf: string|LoggerConf):Logger => {
    conf = normalizeConf(conf)
    return this.logger({
      writer: this.writer,
      ...conf
    })
  }

  public logger = (conf:LoggerConf|string) => {
    conf = normalizeConf(conf)

    let { namespace='' } = conf
    if (namespace && this.namespace) {
      namespace = `${this.namespace}:${namespace}`
    }

    const sublogger = new Logger({
      ...this.conf,
      ...conf,
      namespace
    })

    this.subloggers.push(sublogger)
    return sublogger
  }

  public time = (level:string, msg?:string, details?:any) => {
    const start = Date.now()
    return () => {
      const time = Date.now() - start
      this.log(level, `${msg} (${time}ms)`, details)
    }
  }

  public timeSilly = (msg:string, details?:any) => this.time('SILLY', msg, details)
  public timeDebug = (msg:string, details?:any) => this.time('DEBUG', msg, details)
  public timeInfo = (msg:string, details?:any) => this.time('INFO', msg, details)
  public timeWarn = (msg:string, details?:any) => this.time('WARN', msg, details)
  public timeError = (msg:string, details?:any) => this.time('ERROR', msg, details)

  public log (level:string, msg:string, details?:any) {
    if (this.level < Level[level]) {
      // ignore
      return
    }

    const output = this.formatOutput(level, msg, details)
    const { writer } = this
    const fn = writer[METHODS[level]] || writer.log
    fn.call(writer, output)
  }

  public isSilly = () => this.level >= Level.SILLY
  public isRidiculous = () => this.level >= Level.RIDICULOUS

  // public select = (byLevel: any, ...args) => {
  //   const { levelName } = this
  //   const args = byLevel[levelName]
  //   if (!args) return

  //   this[levelName](...args)
  // }

  private formatOutput = (level, msg, details) => {
    if (!details) {
      details = {}
    }

    if (details instanceof Error) {
      details = { stack: details.stack || details.message }
    } else if (typeof details !== 'object') {
      details = { value: details }
    }

    if (this.outputFormat === 'json') {
      const logMsg = {
        namespace: this.namespace,
        msg,
        level,
        ...this.context
      }

      if (!isEmpty(details)) logMsg.details = details

      return stringifySafe(logMsg)
    }

    const stringifiedDetails = details ? stringifySafe({ msg, ...details }) : ''
    let part1 = this.namespace
    if (part1) part1 += ':'

    return `${part1}${level}: ${stringifiedDetails}`
  }
}

export const noopLogger = new Logger({
  writer: {
    log: () => {}
  }
})

export const consoleLogger = new Logger({
  writer: console
})

export { Logger }
export const createLogger = (conf: LoggerConf|string) => new Logger(conf)

const normalizeConf = (conf: LoggerConf|string):LoggerConf => typeof conf === 'string' ? { namespace: conf } : conf
