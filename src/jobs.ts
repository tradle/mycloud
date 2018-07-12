
import {
  Bot,
  Job,
  Logger,
} from './types'

import { TYPE } from './constants'

const JOB = 'tradle.cloud.Job'
const MIN_PERIOD = 60

export class Jobs {
  private bot: Bot
  private logger: Logger
  private defaultJobs: Job[]
  constructor(bot: Bot) {
    this.bot = bot
    this.logger = bot.logger.sub('jobs')
    this.defaultJobs = []
  }

  public add = (job: Job) => {
    this.defaultJobs.push(normalizeJob(job))
  }

  public save = async (job: Job) => {
    return await this.bot.signAndSave({
      [TYPE]: JOB,
      ...job
    })
  }

  public list = async () => {
    let custom
    try {
      custom = (await this.bot.db.list(JOB)).items
    } catch (err) {
      custom = []
    }

    return this.defaultJobs.concat(custom)
  }

  public listScheduled = async () => {
    const now = fixResolution(getCurrentTimeInSeconds())
    const jobs = (await this.list()).map(normalizeJob)
    return jobs.filter(j => Jobs.isScheduled(j, now))
  }

  public static isScheduled = (job: Job, time:number=Date.now()) => {
    time = fixResolution(Math.floor(time / 1000))
    return time % job.period === 0
  }

  public isScheduled = Jobs.isScheduled

  public scheduleJobsImmediately = async (jobs?: Job[]) => {
    if (!jobs) jobs = await this.listScheduled()

    return await Promise.all(jobs.map(this.scheduleJobImmediately))
  }

  public scheduleJobImmediately = async (job: Job) => {
    return await this.bot.lambdaUtils.invoke({
      name: job.function,
      arg: job,
      sync: false
    })
  }
}

const fixResolution = (seconds: number) => Math.ceil(seconds / MIN_PERIOD) * MIN_PERIOD
const normalizeJob = (job: Job) => ({
  ...job,
  // round up per highest available resolution
  period: fixResolution(job.period)
})

const getCurrentTimeInSeconds = () => Math.floor(Date.now() / 1000)
