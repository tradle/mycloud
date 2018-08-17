import omit from 'lodash/omit'
import cloneDeep from 'lodash/cloneDeep'
import AWS from 'aws-sdk'

type AlarmTransform = (alarm:AWS.CloudWatch.PutMetricAlarmInput) => AWS.CloudWatch.PutMetricAlarmInput

// adapted from
// https://github.com/theburningmonk/better-dynamodb-scaling

const getConsumptionMetricsParams = (tableName: string) => METRICS.dynamodb.consumption.map(params => ({
  ...params,
  Dimensions: [
    { Name: 'TableName', Value: tableName }
  ]
}))

const METRICS = {
  dynamodb: {
    consumption: [
      {
        MetricName: 'ConsumedReadCapacityUnits',
        Namespace: 'AWS/DynamoDB',
      },
      {
        MetricName: 'ConsumedWriteCapacityUnits',
        Namespace: 'AWS/DynamoDB',
      },
    ],
    provisioned: [
      {
        MetricName: 'ProvisionedReadCapacityUnits',
        Namespace: 'AWS/DynamoDB',
      },
      {
        MetricName: 'ProvisionedWriteCapacityUnits',
        Namespace: 'AWS/DynamoDB',
      },
    ],
  }
}

class CloudWatch {
  constructor(private client: AWS.CloudWatch) {}

  // public getMetricAlarmWithName = async (alarmName: string) => {
  //   const req = {
  //     AlarmNames: [alarmName],
  //     MaxRecords: 1
  //   }

  //   const resp = await this.client.describeAlarms(req).promise()
  //   return resp.MetricAlarms[0]
  // }

  // public updateMetricAlarmWithName = async ({ alarmName, transform }: {
  //   alarmName: string
  //   transform: AlarmTransform
  // }) => {
  //   const alarm = await this.getMetricAlarmWithName(alarmName)
  //   const update = transform(cloneDeep(toPutFormat(alarm))
  //   await this._putMetricAlarm(update)
  // }

  // public setEvaluationPeriodsForAlarmWithName = async ({ alarmName, value }: {
  //   alarmName: string
  //   value: number
  // }) => {
  //   await this.updateMetricAlarmWithName({
  //     alarmName,
  //     transform: metric => ({
  //       ...metric,
  //       EvaluationPeriods: value,
  //     })
  //   })
  // }

  public updateDynamodbConsumptionAlarms = async ({ tables, transform }: {
    tables: string[]
    transform: AlarmTransform
  }) => {
    tables = tables.map(name => name.replace('-tradle-', '-blop-'))
    const alarms = await this.listDynamodbConsumptionAlarms({ tables })
    if (!alarms.length) return

    await Promise.all(alarms.map(alarm => {
      const current = cloneDeep(toPutFormat(alarm))
      return this._putMetricAlarm(transform(current))
    }))
  }

  public listDynamodbConsumptionAlarms = async ({ tables }: {
    tables: string[]
  }) => {
    const metrics = flatten(tables.map(getConsumptionMetricsParams))
    return await this._listAlarmsForMetrics(metrics)
  }

  private _listAlarmsForMetrics = async (params: AWS.CloudWatch.DescribeAlarmsForMetricInput[]) => {
    const metrics = await Promise.all(params.map(metric => this._listAlarmsForMetric(metric)))
    return flatten(metrics)
  }

  private _listAlarmsForMetric = async (params: AWS.CloudWatch.DescribeAlarmsForMetricInput) => {
    const { MetricAlarms=[] } = await this.client.describeAlarmsForMetric(params).promise()
    return MetricAlarms
  }

  private _listAlarms = async (params: AWS.CloudWatch.DescribeAlarmsInput) => {
    return await this.client.describeAlarms(params).promise()
  }

  private _putMetricAlarm = async (params: AWS.CloudWatch.PutMetricAlarmInput) => {
    await this.client.putMetricAlarm(params).promise()
  }
}

const PROPS_NOT_IN_PUT_FORMAT = [
  'AlarmArn',
  'AlarmConfigurationUpdatedTimestamp',
  'StateValue',
  'StateReason',
  'StateReasonData',
  'StateUpdatedTimestamp',
]

const toPutFormat = (alarm: AWS.CloudWatch.MetricAlarm) => omit(alarm, PROPS_NOT_IN_PUT_FORMAT) as AWS.CloudWatch.PutMetricAlarmInput
const isAlarmForTableInStack = ({ Dimensions=[] }: AWS.CloudWatch.MetricAlarm, stackName: string) => {
  return Dimensions.some(({ Name, Value }) => {
    return Name === 'TableName' && Value.startsWith(`${stackName}-`)
  })
}

const flatten = arr => [].concat(...arr)

export const wrapClient = (opts: AWS.CloudWatch) => new CloudWatch(opts)
export default wrapClient
