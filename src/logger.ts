// inspired by
// http://theburningmonk.com/2017/09/capture-and-forward-correlation-ids-through-different-lambda-event-sources/

import isEmpty from 'lodash/isEmpty'
import stringifySafe from 'json-stringify-safe'

export const Level = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  VERBOSE: 3,
  DEBUG: 4,
  SILLY: 5,
  RIDICULOUS: 6
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

export default class Logger {
  public namespace:string
  public context:any
  public level:number
  public subloggers:Logger[]
  private writer:Writer
  private outputFormat:string
  private conf:LoggerConf
  constructor (conf:LoggerConf|string) {
    if (typeof conf === 'string') {
      conf = { namespace: conf }
    }

    const {
      namespace='',
      context={},
      level=Level.DEBUG,
      writer=global.console,
      outputFormat='json'
    } = conf

    this.conf = conf
    this.namespace = namespace
    this.context = context
    this.level = level
    if (level < 0 || level > HIGHEST_LEVEL) {
      throw new Error(`expected level >= 0 && level <=${HIGHEST_LEVEL}, got ${level}`)
    }

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

  public ridiculous = (msg:string, params?:any) => this.log('RIDICULOUS', msg, params)
  public silly = (msg:string, params?:any) => this.log('SILLY', msg, params)
  public debug = (msg:string, params?:any) => this.log('DEBUG', msg, params)
  public info = (msg:string, params?:any) => this.log('INFO', msg, params)
  public warn = (msg:string, params?:any) => this.log('WARN', msg, params)
  public error = (msg:string, params?:any) => this.log('ERROR', msg, params)
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

  public time = (level:string, msg?:string, params?:any) => {
    const start = Date.now()
    return () => {
      const time = Date.now() - start
      this.log(level, `${msg} (${time}ms)`, params)
    }
  }

  public timeSilly = (msg:string, params?:any) => this.time('SILLY', msg, params)
  public timeDebug = (msg:string, params?:any) => this.time('DEBUG', msg, params)
  public timeInfo = (msg:string, params?:any) => this.time('INFO', msg, params)
  public timeWarn = (msg:string, params?:any) => this.time('WARN', msg, params)
  public timeError = (msg:string, params?:any) => this.time('ERROR', msg, params)

  public log (level:string, msg:string, params?:any) {
    if (this.level < Level[level]) {
      // ignore
      return
    }

    const output = this.formatOutput(level, msg, params)
    const { writer } = this
    const fn = writer[METHODS[level]] || writer.log
    fn.call(writer, output)
  }

  private formatOutput = (level, msg, params) => {
    if (!params) {
      params = {}
    }

    if (params instanceof Error) {
      params = { stack: params.stack || params.message }
    } else if (typeof params !== 'object') {
      params = { value: params }
    }

    if (this.outputFormat === 'json') {
      const logMsg = {
        namespace: this.namespace,
        msg,
        time: new Date().toISOString(),
        level,
        ...this.context
      }

      if (!isEmpty(params)) logMsg.params = params

      return stringifySafe(logMsg)
    }

    const stringifiedParams = params ? stringifySafe({ msg, ...params }) : ''
    let part1 = this.namespace
    if (part1) part1 += ':'

    return `${part1}${level}: ${stringifiedParams}`
  }
}

const noopLogger = new Logger({
  writer: {
    log: () => {}
  }
})

export {
  Logger,
  noopLogger
}

const normalizeConf = (conf: LoggerConf|string):LoggerConf => typeof conf === 'string' ? { namespace: conf } : conf
