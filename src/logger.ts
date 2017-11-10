// inspired by
// http://theburningmonk.com/2017/09/capture-and-forward-correlation-ids-through-different-lambda-event-sources/

export const Level = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  VERBOSE: 3,
  DEBUG: 4,
  SILLY: 5
}

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
}

const COLORS = {
  ERROR: 'red',
  WARN: 'yellow',
  INFO: 'blue',
  VERBOSE: 'cyan',
  SILLY: 'pink'
}

type Console = {
  log: Function
  [x: string]: any
}

type LoggerConf = {
  namespace?:string
  context?:any
  level?:number
  console?:Console
  outputFormat?:string
}

export default class Logger {
  public namespace:string
  public context:any
  public level:number
  public subloggers:Logger[]
  private console:Console
  private outputFormat:string
  private conf:LoggerConf
  constructor (conf: LoggerConf) {
    const {
      namespace='',
      context={},
      level=Level.DEBUG,
      console=global.console,
      outputFormat='json'
    } = conf

    this.conf = conf
    this.namespace = namespace
    this.context = context
    this.level = level
    if (level < 0 || level > 5) {
      throw new Error(`expected level >= 0 && level <=3, got ${level}`)
    }

    this.console = console
    this.outputFormat = outputFormat
    if (!FORMATS.includes(outputFormat)) {
      throw new Error(`expected outputFormat to be one of: ${FORMATS.join(', ')}`)
    }

    this.subloggers = []
  }

  private log (level:string, msg:string, params?:any) {
    if (this.level < Level[level]) {
      // ignore
      return
    }

    const output = this.formatOutput(level, msg, params)
    const { console } = this
    const fn = console[METHODS[level]] || console.log
    fn.call(console, output)
  }

  private formatOutput = (level, msg, params) => {
    if (this.outputFormat === 'json') {
      const logMsg = {
        msg,
        time: new Date().toISOString(),
        level,
        ...this.context
      }

      if (params) logMsg.params = params

      return JSON.stringify(logMsg)
    }

    const stringifiedParams = params ? JSON.stringify(params) : ''
    return `${level}: ${msg} ${stringifiedParams}`
  }

  public setContext = (value:any) => {
    this.context = value
    this.subloggers.forEach(logger => logger.setContext(this.context))
  }

  public debug = (msg:string, params?:any) => this.log('DEBUG', msg, params)
  public info = (msg:string, params?:any) => this.log('INFO', msg, params)
  public warn = (msg:string, params?:any) => this.log('WARN', msg, params)
  public error = (msg:string, params?:any) => this.log('ERROR', msg, params)
  public logger = (conf:LoggerConf) => {
    const sublogger = new Logger({
      ...this.conf,
      ...conf,
      namespace: conf.namespace ? this.namespace + ':' + conf.namespace : ''
    })

    this.subloggers.push(sublogger)
    return sublogger
  }
}
