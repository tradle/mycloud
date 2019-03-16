import getValues from 'lodash/values'
import Errors from './errors'
import { Bot, Job, Logger } from './types'

const JOB = 'tradle.cloud.Job'
const MIN_PERIOD = 60

type JobMap = {
  [name: string]: Job
}

export class Scheduler {
  private bot: Bot
  private logger: Logger
  private defaultJobs: JobMap
  constructor(bot: Bot) {
    this.bot = bot
    this.logger = bot.logger.sub('jobs')
    this.defaultJobs = {}
  }

  public add = (job: Job) => {
    validateJob(job)
    if (this.defaultJobs[job.name]) {
      throw new Errors.InvalidInput(`job with name: ${job.name}`)
    }

    this.defaultJobs[job.name] = normalizeJob(job)
  }

  // public save = async (job: Job) => {
  //   return await this.bot.draft({ type: JOB })
  //     .set(job)
  //     .signAndSave()
  //     .then(j => j.toJSON())
  // }

  public list = async () => {
    // let custom
    // try {
    //   custom = (await this.bot.db.list(JOB)).items
    // } catch (err) {
    //   custom = []
    // }

    // return getValues(this.defaultJobs).concat(custom)
    return getValues(this.defaultJobs)
  }

  public listScheduled = async () => {
    const jobs = (await this.list()).map(normalizeJob)
    return jobs.filter(j => Scheduler.isScheduled(j))
  }

  public static isScheduled = (job: Job, time: number = Date.now()) => {
    time = fixResolution(Math.floor(time / 1000))
    return time % job.period === 0
  }

  public isScheduled = Scheduler.isScheduled

  public scheduleJobsImmediately = async (jobs?: Job[]) => {
    if (!jobs) jobs = await this.listScheduled()

    return await Promise.all(jobs.map(this.scheduleJobImmediately))
  }

  public scheduleJobImmediately = async (job: Job) => {
    this.logger.debug(`scheduling job: ${job.name}`)
    return await this.bot.lambdaInvoker.invoke({
      name: job.function,
      arg: job,
      sync: false
    })
  }
}

export default Scheduler

const validateJob = (job: Job) => {
  if (typeof job.name !== 'string') throw new Errors.InvalidInput(`expected string "name"`)
  if (typeof job.period !== 'number') throw new Errors.InvalidInput(`expected number "period"`)
  if (typeof job.function !== 'string') throw new Errors.InvalidInput(`expected string "function"`)
}

const fixResolution = (seconds: number) => Math.ceil(seconds / MIN_PERIOD) * MIN_PERIOD
const normalizeJob = (job: Job) => ({
  ...job,
  // round up per highest available resolution
  period: fixResolution(job.period)
})

const getCurrentTimeInSeconds = () => Math.floor(Date.now() / 1000)
