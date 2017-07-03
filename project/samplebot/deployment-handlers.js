const debug = require('debug')('tradle:sls:deployment-bot')
const co = require('co').wrap
const clone = require('clone')
const omit = require('object.omit')
const { prettify } = require('../lib/string-utils')
const Buckets = require('../lib/buckets')
// const ServerlessDeploymentBucket = require('../lib/s3-utils').getBucket('tradle-dev-serverlessdeploymentbucket-nnvi6x6tiv7k')
// const PublicConfBucket = require('../lib/s3-utils').getBucket('tradle-dev-publicconfbucket-gd70s2lfklji')
const { getFaviconURL, getLogoDataURI } = require('../lib/image-utils')
const { s3 } = require('../lib/aws')
const utils = require('../lib/utils')
const templateFileName = 'compiled-cloudformation-template.json'
const {
  // SERVERLESS_STAGE='dev',
  // SERVERLESS_SERVICE_NAME='tradle',
  SERVERLESS_STAGE,
  SERVERLESS_SERVICE_NAME,
} = process.env

const artifactDirectoryPrefix = `serverless/${SERVERLESS_SERVICE_NAME}/${SERVERLESS_STAGE}`
const MIN_SCALE = 1
const MAX_SCALE = 3
const CONFIG_FORM = 'tradle.aws.Configuration'

const getBaseTemplate = (function () {
  let baseTemplate
  return co(function* ({ resources }) {
    const { ServerlessDeploymentBucket } = resources.buckets
    if (!baseTemplate) {
      const objects = yield s3.listObjects({
        Bucket: ServerlessDeploymentBucket.id,
        // Bucket: 'tradle-dev-serverlessdeploymentbucket-nnvi6x6tiv7k',
        Prefix: artifactDirectoryPrefix
      }).promise()

      const templates = objects.Contents
        .filter(object => object.Key.endsWith(templateFileName))

      const metadata = latestS3Object(templates)
      if (!metadata) {
        debug('base template not found', prettify(objects))
        return
      }

      baseTemplate = yield ServerlessDeploymentBucket.getJSON(metadata.Key)
    }

    return baseTemplate
  })
}())

function normalizeParameters (parameters) {
  parameters = clone(parameters)
  let scale = Math.round(parameters.scale)

  if (scale < MIN_SCALE) scale = MIN_SCALE
  if (scale > MAX_SCALE) scale = MAX_SCALE

  parameters.scale = scale
  return parameters
}

const writeTemplate = co(function* ({ resources, parameters }) {
  const template = yield getBaseTemplate({ resources })
  const customized = generateTemplate({ resources, template, parameters })
  const templateKey = `templates/scale-${parameters.scale}.json`
  const { PublicConfBucket } = resources.buckets
  try {
    yield s3.putObject({
      Bucket: PublicConfBucket.id,
      Key: templateKey,
      Body: JSON.stringify(customized),
      ACL: 'public-read'
    })
    .promise()
  } catch (err) {
    debug('failed to save template', err.stack)
  }

  return templateKey
})

const onForm = co(function* ({ bot, user, type, wrapper, currentApplication }) {
  if (type !== CONFIG_FORM) return

  const { object } = wrapper.payload
  const { domain } = object
  try {
    yield getLogoDataURI(domain)
  } catch (err) {
    const message = `couldn't process your logo!`
    yield bot.requestEdit({
      user,
      object,
      message,
      errors: [
        {
          name: 'domain',
          error: message
        }
      ]
    })
  }
})

const onFormsCollected = co(function* ({ bot, user, application }) {
  const configForms = user.forms[CONFIG_FORM]
  const latest = getLatestFormVersion(configForms)
  const form = yield bot.objects.get(latest.link)
  const parameters = normalizeParameters(form.object)
  // parameters.logo = yield getFaviconURL(parameters.domain)
  const templateKey = yield writeTemplate({
    resources: bot.resources,
    parameters
  })

  const { PublicConfBucket } = bot.resources.buckets
  const templateURL = `https://${PublicConfBucket.id}.s3.amazonaws.com/${templateKey}`
  const launchURL = utils.launchStackUrl({
    stackName: 'tradle',
    templateURL
  })

  yield bot.send({
    to: user.id,
    object: `[Launch your Tradle stack](${templateURL})`
  })
})

function getLambdaEnv (lambda) {
  return lambda.Properties.Environment.Variables
}

function generateTemplate ({ resources, template, parameters }) {
  const { name, scale, domain } = parameters
  template.Description = `My Tradle Cloud instance`

  const { Resources } = template
  getLambdaEnv(Resources.BotUnderscoreonmessageLambdaFunction).PRODUCT = 'tradle.aws.CurrentAccount'

  const deploymentBucketId = resources.buckets.ServerlessDeploymentBucket.id
  for (let key in Resources) {
    let Resource = Resources[key]
    let { Type } = Resource
    switch (Type) {
    case 'AWS::DynamoDB::Table':
      debug(`scaling ${Type} ${Resource.Properties.TableName}`)
      scaleTable({ table: Resource, scale })
      break
    case 'AWS::Lambda::Function':
      // resolve Code bucket
      Resource.Properties.Code.S3Bucket = deploymentBucketId
      let lEnv = getLambdaEnv(Resource)
      lEnv.ORG_NAME = name
      lEnv.ORG_DOMAIN = domain
      delete lEnv.ORG_LOGO

      break
    default:
      break
    }
  }

  // write template to s3, return link
  return template
}

function scaleTable ({ table, scale }) {
  let { ProvisionedThroughput } = table.Properties
  ProvisionedThroughput.ReadCapacityUnits *= scale
  ProvisionedThroughput.WriteCapacityUnits *= scale
  const { GlobalSecondaryIndexes=[] } = table
  GlobalSecondaryIndexes.forEach(index => scaleTable({ table: index, scale }))
}

function last (arr) {
  return arr[arr.length - 1]
}

function getLatestFormVersion (formState) {
  return last(last(formState).versions)
}

function latestS3Object (list) {
  let max = 0
  let latest
  for (let metadata of list) {
    let date = new Date(metadata.LastModified).getTime()
    if (date > max) latest = metadata
  }

  return latest
}

module.exports = {
  onFormsCollected
}

// co(function* () {
//   const templateKey = yield writeTemplate({
//     resources: require('../lib/resources'),
//     parameters: {
//       name: 'Silly',
//       scale: 1,
//       logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAAAXNSR0IArs4c6QAAAAlwSFlzAAALEwAACxMBAJqcGAAABHhpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDUuNC4wIj4KICAgPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICAgICAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgICAgICAgICAgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iCiAgICAgICAgICAgIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyIKICAgICAgICAgICAgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIj4KICAgICAgICAgPHhtcE1NOkRlcml2ZWRGcm9tIHJkZjpwYXJzZVR5cGU9IlJlc291cmNlIj4KICAgICAgICAgICAgPHN0UmVmOmluc3RhbmNlSUQ+eG1wLmlpZDowMTgwMTE3NDA3MjA2ODExQTBBREUyODRFNDE4ODlCMDwvc3RSZWY6aW5zdGFuY2VJRD4KICAgICAgICAgICAgPHN0UmVmOmRvY3VtZW50SUQ+eG1wLmRpZDowMTgwMTE3NDA3MjA2ODExQTBBREUyODRFNDE4ODlCMDwvc3RSZWY6ZG9jdW1lbnRJRD4KICAgICAgICAgPC94bXBNTTpEZXJpdmVkRnJvbT4KICAgICAgICAgPHhtcE1NOkRvY3VtZW50SUQ+eG1wLmRpZDo5MTczOEE2NjFFNDMxMUU3QjQxMzkzRDVCNDU3RkU2MjwveG1wTU06RG9jdW1lbnRJRD4KICAgICAgICAgPHhtcE1NOkluc3RhbmNlSUQ+eG1wLmlpZDo5MTczOEE2NTFFNDMxMUU3QjQxMzkzRDVCNDU3RkU2MjwveG1wTU06SW5zdGFuY2VJRD4KICAgICAgICAgPHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD54bXAuZGlkOjAxODAxMTc0MDcyMDY4MTFBMEFERTI4NEU0MTg4OUIwPC94bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ+CiAgICAgICAgIDx0aWZmOk9yaWVudGF0aW9uPjE8L3RpZmY6T3JpZW50YXRpb24+CiAgICAgICAgIDx4bXA6Q3JlYXRvclRvb2w+QWRvYmUgUGhvdG9zaG9wIENTNSBNYWNpbnRvc2g8L3htcDpDcmVhdG9yVG9vbD4KICAgICAgPC9yZGY6RGVzY3JpcHRpb24+CiAgIDwvcmRmOlJERj4KPC94OnhtcG1ldGE+Cp5YFKYAAEAASURBVHgBxb0JtGVHeR5a5449zy0htSaEJDQzSEiyzcISBjMKSQxCcl5e/Jxly35+JrzEznKMhxsHAcZObGMvxyIryUriBEd+7/EiYwQigBSMGBwDEohBA5qHltQt9dx3zvf9f31V/66zz+0rWFmp7r2r6p+H2rVrD2ffQfohyuUzn5+4Pd2xlGZmllzM8uCNN95ywfLi8iWDpeVXLKd0VhoMTkhp+UXAb0rLaXJ5GdBQBoNB6IGywce+2qojL2GCQwraLtZhtR+VVfoIbWygIJqIqmt5Q9cVMdQzL7Ovo/QGpnnEbT94nlpeXnpykAb3DgbjX4cBX/3C713/TRjkpszMjF2efnzs9pkrFgLvC2p2o79KVkv8zBWLIDdD3jRzy2WDsXQ9um9MY2NnTUyvswQsLy2m5aWFtLTImmPE7W4DUBM5nKhK2+LaPo2vMPG1tVFpdLCTi+jUZ01Yzn0Ehzb9qSE0eiQ5ymLOe9RReoc3CEXukfKxcWxjuR439OLsEXp4L0TeOj42+NjnP3j9VzLf4PKZmfHbZ2Ze8ECo1kcLRrRnMOJuDyPuLTd+4rrlpeX3jk1MXDoxtSYtzs+lxYU5ZoGDA2UZ0cBwhT+AQVc3OE6z8j4GM7YZVYawAwuiCG9x6qsWedsnvA8m+lrDAsujh3F1PJX7GC1zD5IRwXzEp8H4+OTkYGxiOi0tzKblxfmvAPcHt3/guj+nLAwCzMgpzMjH0AD0qgdAPupthF154yfftJwWPzSxZsOFy4sLaXHu6NLyYMDDnEN1rE8sg9MXoAjTTBBhXRcoo5ucUbQGz4PEZTgv2+JR3dVR8S2cuejzjXSjZEUZpDEf6UQ+HUQ828S3smxGAI7akbElHE+L8AaDYc3YGGaK+dlDd4PxV+/4wHW3kiTmiv2VyqoGwEU33TT5tzfcMP+WD35i69jy4E8xxV/L6X1h7igHBAfpOH0aVapTNQmibZ0VvK1bOvVVkz62Ga5oU8UFOAiGzQ741ohOf7V0HaaOjTYYuujSc5zriHSxDZ/sNDw+tWZigHPw4tyRm48eGfzCl37/2r0X/Rxy9tEb5ovAEY1jDQCcWz6Pc8sVC1d+8JOvBfHNk2s3bJ87chCJt+l9nFFug6hgR2OlX7hR/T445US+2I6J7oe3ier2uzztIJI1rLt8EWPYONoapOIgXeo7GaPXTUMX3xUmHCcQqqRMzgjYLSM3EwtHDu1ZHixf+7n3X/s5OyXMzJS1WleS97qaOxTLg5mZhG2wdPWHPvlLY5NrPsKjfmlxYR5KJ0lqynNy5FxHxAod53UnRBZlyFFQmKOkifg+nohXm7WCNSyjyu6TJ1isJbcPRj08GtoDItKybXQGHA6//Da7u8Tl9NChqcJIPT9mi4SxtDQ/+57/+v53/dHMzPIY8giTtI4wxWU3bIGjkHgOgMHSVb/zqfdPrd34vrnD+znUliAK0/2wi32woqWn0UffwmLiGNYetZ1BEfl/mHaPuR09LV66LJjY9dnZ8rCvRFobO0ZVMMk0XDfJBFkRrfqsoR7rg8HY1LqNg4XZgzfeNvP2X/dBYANgKHG9A0CLiGs+9KkbJzds/rW5Q/t4rmfih+ijoTRA/T7jiGcRjffiPieZEWycFg8oPFKRzdp1gIhWJOqrbuHqs+7SuEw63UauSxclHLvtrnVDqXhFuYJJonGAmTQtTjS5xpp8sDi5btPE/JH9NgiU04aOA6Zbfu6m/z750Rsunr/6w5/+pel1Gz8ye+jAAmYPnOtJW4McuWS0G+WhWu1RIN4or68turamTsEin2CqHddjPwztJrelGeVPl45Jlc+jbKIN/cmvvPLBY6letzZctrtPnlHj0hEmLU6u3Tgxd/TAe277rWv+qG9h2BkAGiXX/O6nXzs+Mf3ZxflZxcboYjBju2ve6nor8QsXAxkDLHys24AJR2tiW/0+2EqWt/R9tMeiaW2UjOhnhKnd1pF+RZlwnYkbm5gazM/Ovu4zv33NZ5VjycQ1uxe7yYPV/ls++IWtOCRu5oIPhbfvyiCJynABatMQYe3mEjnauzjBWbc49YmT7EhHM0TT1qInXCXSVLxjhYvySTM21qeDttKmPlzUB5rGX+lhXW0YljNsh6cl8ksG7Yj01sGONkZ6o7GgpSXcTob+5ZvfMHPzNl7RMdfim1CDd/jQXpqaOPKnWPRtnzt8gNeQttoXDWsqUaFTpXD+A45HgWisTYLMA9fRqVMu6XTUqBZvxBUduSEadsXX0rR952HwnWdYPqd0x0uu01RJ2Y2OzmgL3avRqXxsdei6KOu1+LYvGTnMPRJG6hjHHcP56fWbt80fOXgTGN91z7nnFjOtoWnhHR++7c3ja9b+1fzRIwtwdqIvuDLMGEGkmhZFerZjv9fiDBxF1wcnTDYYnnokvESHuh0oGeRRW+SsBVMdcREvuOhaeW2f9LJTvCNrBJGRlAzqWDVvI1QyxB/sXcANvIm52YNv+dRvXP1J5dzyJxnXfPi2uyempi9YnD+K+X/gTyCERC2hpSZOh4XRIer+33tMTt4MEHZ0OKSu0AeS4SZlDUNfcBIlQsFRn3WExXakOVabfIrRSrQeuk4KTH8ffCU5K+MYMQ6utIhbx+NY133zr379ygvFM8aRwM7VH77t+ql1Gy5Ymp/D1N+ffJpKx7jZOU3rgALvrgv8vMpzq8Oph8WCk0e99Q3q8DHc0pQODpJOybor3rGiKvBMJ94IF4y14LEtGGv30f2N8GO15e+x6Hj7to8GlrmZjFHw2YHD+0gz3FbsB+N4UDePu4UXXHnjX/4UpTD3nBfp4fI1H/70Vyam116CBztc/XWO/lbosAkOodntEcqjIW6jePvgfUdgH0y8La7t99PRPmFWrkfJW5lrGMt4ShbbLOpHasNkfB+NeCNP26bcQGezwMLcka9iFrgUSl3623/nM5eNTU18aWlhDqt+DMum2OrWjmIi3OBIEhREML2yAUEjtHUJur2+IESKUXjC28E3ipbyWlzb5zCGyP+lRTE138KA6TOqHSiRRvyEWRsL/cH45Nj8wuyP3Prrb/uyTf/LY0vX83n+/MICHzN2BoAZUkahJ9/PKq5GhkalpQ2+drgMB7tQl5HaGi2KIV0whENMcOmK/OKNekUvnPc96Ww7v7BeR35CjCfr71Kuvidd9KL/wKIseeVy3VZvr2Yf6XN7cWJ6zRgOdrzAk76M+/0zY3et+5Hvjk9OndmZAbJNZNI5TQrxNgovLtHtGid8X80A2sY3g/KAaoPaxydYS8uhxeTHIhrarDbxsR3pve2Jb+F9PPS2q7HlemF96bAo5phQguwnPiet40MLM3ryNQNJ8rtWLWMGmOIAuO/i+f9+9uAdv/tfL8Tjw7uWlpbMNxiT7bGqJJ9KeCqYA9lrTt+avvbovnRkATcYguFdRe6IwZh8NKCj40hL3+lnng7sGJ3W4bbfYc/yNUe1gynSrignEq66PTzolNSuiGE64kXLDB2YW0wve9EGxDWlu3cfTBun8CRwhVGafcHJf2ywNFh4+RjuEl3Cd/iQIbzRg6FASU2hQirjUb9uYiyddcLmNIeTRZt8HzLOLCOtR34gI8xkZrmRr6g2HvKN2DJhr0yTO4Iv42iQ8VJ5tq3oKkZ4o8B7bBFppCEs9tUWLRUSxpl1HG/0sFbpxiL70MgjLfk5Ex9EHnZunE7n7tqc9swvpYl8xUV8X8m24BnBery6NX7JBI7JV7pATpXVcIdJCKeisXQICk7fOp1O2LYu7cPI27pmYmi0iWNYOZ1x+Rxk3MzIbOhoviyJxqm4IBuURY5wpSZ9V2oZ3LSjwRU2NIY5I7bbLoGWffIn11EYdXKmKTwUpTgEsdFqs7mRSbyiMQf+9dMT6cwTt6Q9Cw+nswJzR4+pEheVgXA5vZKLwDP9vr8niKhYXAhGG+j3zS+mU7evS9s3rU18TIQrTHtBINLHttkC40vggXRfqpUyMtJEGaWtgBaAN8RfwAiIJXAEfaHra4BxKEF9dH0w6jPF9LH6bG1DgAkkvM9hvuYBk1m6gyLIH/Iv4xhBPhbAK7hpHQbAaSdsSZsxO680/Zss6jWj8BLRYHAmWAa7/JXtJczoeSqSVVJmhg/SAUw3J21fn7ZuXJM2gHMxOxHszY5QAAvN7AaEsL7cjHLUBPTuoMP/d7BRjmvnbOMkEddhUgcMem9GHgi1qtoVGil1aVD3zjY5CIFlpArNHC0BRSAlae3URNq5dX06E6eCOayzxqm7JUYQDEYmnur5sG857eJBfDzf7MXlf7WltkyMBZDKQLxzy9q0fs1UOn79ZJqF9uyH0VmAqcg15cHQWvLC+lF+lxMGAUmdcYswp+/iI23jZibvl9vha3SOwunqaRR+Jbh8ZfLtf6OTeK7BOBNv3bAGs8BkOn3b2nRo1MJc/JmRv9Vg7nnIb+LjQldDrBcaZ8WzaUndgPMAlRF1CgbC4UUfbXKEI56516NT8hc5Jsx3Th/bTJLTSpZqWql2rVvaIBxN0ckO9VUXagXlWHWvDX12BVhWQp1tkR19tWgNl7MCqQaOsrztV2bHbcUiHmUXcnJwgYtz6/bv6CujjZxjCtjMAVAeCZODvFGRHcxI7CJOLtunxtPGdVMkSy89YWPab8q62mSYEWFngyIPIsKqbA+W6Fxz7cVW5RG0q5O8pNEmqi68QnnkiPbYNfigbhQdZXGgtUc7GJyH7NZW7XBaY3A2Qol6pLfUoIt4noJPWzuRXrRtg0k4EQOBp+loDxHiMaKwwyl/bMIO7WxswFnTw8whMEjzOLfsWDuZ1q3xVwReumtLWlh+BMKdi4lmm8pKAczOg6wLcHUNkxJkdeR2RATJaKpHfrWdnIGvjKGZKes5u1Kx5XzO2+Xq0rnv5i+5sjLaIC6EoRThaZTwjgSR/7dBJQaLLzoSwUX5fqwAX4l7ADz/sxy3ZZ0vzk23UxY9wLMt+4wBuwkzIBsrYKkLfDkdxdF+6paJtAYLDpZTjt+UztyERQfXAehndYZjj84WZZQTvc9UrKKBATyy6fQu34lyAGlEo4fTmwLWL5BG8j+Z+22pvnXxw8GkJg2yGuhKFySFAyJAzQbKyP9z3yvFifSMJe8BPIHf5fwfp29PUxP+7G7LhmlbADpJv+fVHpeLGcxEei/sI5wUR3G+37JmPE1N8rcgy2kL1gKvPm1L2n14HsbE4DTJt8GgELsCyvYtKAzNivfkxn6WkPldjiU+JFH0hKtd6qzHvcY+0AQTarMHD5AVl6k21tOGyJILn8eGOK1JOjozXVXYbWVVDZBxGaQ1mAZeccZxBcfZeS0Ghg1Fs8VRvTIyFw+SeqRmYMtA43m5sWaSFw02AI3yspcel57nqhNQjTfeUfYj3+t44HvAgvTMFOFsd0rul9mkg/wBOpBnOlo9EDWkO4iXjU5TbWQi/Pzv/ENrAeDFC4rSrjBXosFBuNYorMEwxMOjfz9uyv3YiRvTaS/aWqzk5eB6XJ7zcJOFpiffHRQhYSo2ACLAEIGAfRrCB8Ub8/lf0s89bUe64sQN6fnZhYR7yp74XMfEtzKLvuyc4bErcAHy7MEucTTb6sz3w7SLTMnNspVA+qy27Ir6lCQYRFEoqoONhGZbjSK3JS/CyE9RhhOPahLmwmNmEgPgocML6cpXnpwmeT8GszOLDkKzpIe3tYU8NgDYUKERKmzKWKS3uEg4j3See95xySnp3oNzMMqfFcgIyWAtGbEdjYm0onGe7ui3CLXEK/VtFLpF7Qwi/VbzCAn30Jl46bIYQIfiYvRupPklOb1m5CSIpiNDHZOtoKvuSqv8vCOLG3I4Gn/0uHXpsnN3GSHxKn1t+a55QTSshwYAXK1Cs2CNuqO4FeyFR4fTXXruiendZ25Nu48s2Mgshoiy2mYBE35ULeOIZzv2R/FEOE02PhdAKYZeSY4C5HJ8Jsuu+1FlnWCLkM5gGmRrW2eS7EeVUezMsiKfeNqaeZjGgusBHP1///Iz0lrcAuYDOplDGW1CJddk5diwTThLh95BBu/sGKApJPzgrA8AKaRyToU/8xNnJ3whoCwOTDjgruTYCZCRMqqjvHSqfIIiT2wr4YyKwyutRIm+05dMpJN4ymGtqb6VJRlGW3RJp+qubqM1ydQsGq8JUSmyARCPJ3+QHjwwm/7+BcelS8450chpH3EsczhAZ5GHwm9+OI6w7kB32Z0BAE6nxj4SU8EkcPtxrl/I5xsSUjlPBScftyn92uvOSN/YN5fW2iKE2FrkRIXQfRpQHYy4/rYRF+f6abpQd8d9cn012LFvdE5sAmoA0QVcfbe6q2PlXtXXoQu6BK86BEGd6YjjeZ/vX5y8cSr9vdedY0QxRwQcOjqfFvB4eXp6Ctu01VNTU7aWKbQ2Y3hMyGMDoFWu4JCABTxpDRK7G+f6IxgEgrHWqeD1F52WbnjZ8el7+zEIeJcCpZVrQO3MuWqIwKqFkS0ryhIT6kjPXuGDvg4uB9dZpY0Capsc5G+LZPbWLbGJrHIkT7wtufARThN4sD1waCH9xtvOt4dxPPBa2ucOIfZTk2l8nO8YUCee+KM9jUEwOakbvu4PfWPBekfXr0Fl47Smn8cPzaf9h2YzoSaeOlv8/JsvSG8+fUu6/8CImQCcoxwP2t0x2GAONra0dJJXgjGcr+yqKY/sxRbxklXqWt1DejqSQkd2BxCbLtuNk75IEs2Ouph4fP4j3fX8bPrjq89NZ5+6w877OvAkm/XT+2bTNBLPA5Yaix7wT076wCjByAptBijTA9g4ILhNTEzkzd9Y4bXns3gJ5Nn9hym9nHfYpiKuB3hJ8n9f9bJ0+cmb0gOcCdDvFNDVUgdQhbms2O9rK0Atzh2m45TjWKvQaXnUl0XGa0whcFmBy+1q64NFCpcfINkg2SWM07nB1s4IJpErfoQ93YVT658g+T92/kl2auagiEW2PPbc4bQei0Qux1QqJQYScqqinJdTABEUzCljApd3Ggj8CJFPKX4T6NGnD0hGpyYvB8F63Cv4jWsvSlefvT3dtfcoVq3uRMlI4aqmEVQCUfDdBn1uaRQwShKONXq2Wdv6VZboCgR4wbwumJENkwus+EYSlsMtUITkBGhtZvun8ZONowuL6XGs+P/1O89Pr77Aky/dYvCj3c//9z97JG3A9Tjz4AV18L9vtscAcGIKHrNzB8cEA1gLGflzgePwzPnuR543RDsKCdQg4O3i91718vQrP3Zy+iamLqxdfGqqIjut1qkOsnSqTZ3A08HgZCFvGhrxDTh0GYcaC9mkOhAONc2eIagDIr+1s60RHlnpJT75lB7F+X4d7uzd9FOvSK86+wRLah8P78+wPLX3kM+6vCFTisesj08wZtbICbBEF+Zug/eatuPR452P7oeyg4bsCyoHAeH087rLX5r+9bsvxA2jsfTwwXm7d80pLRYZEmFqU4ZvlWklevH11eSTLG8HmcbAvjaX8IJ0mfwqM9rQyhFVa8cUZktO3994bja945wd6Y9/+pJ01snb7Eqr74CLOu55+Dk8sUXc6UO2hf6qUFebL8J8uJQpQ+S1rsZjIYHzy2N4AvXdR/YawSg2V+aLw5e95Lj0kf/94vTuC3babMAXS8tpoaoZarleelC9qLYMkRvAqIvz7dReZXkg6vWypFF+q6NqFxVrP+oEEV+shVMtuVDho1oI1FOIKy/zuG7iWutP335u+kX8fnPTenwQEkmNC77AZk0OjDmcKr54/7PpOLyky/c2aulaz9fyW9t9AJhVlU2tLnvCVI53AqHks/c8ZYpWMowi6TQd4JPDG950vs0GZ+K1pbtxWjiMx8vTmBnyFaNU/sC1BXjID7+rp4RL+BAZANFXJcvoAzHhjqvUda3ki2edZyuttCoxzsvEMfETSPgjmB2fwp3Un734RBz1r0qX5ps8tHulGOtcf++je9Mdj+3D+R/xlrpcy5dFvAK2sMBL+K6vtiwUERWqTX6aXFwFjqNr2/R4+vRD+9J1Dz+bznvxzmOPUDjoCRikC0/fmc45ZVu65t7d6ZavPZ4+//iBtBNvGW3HoGLhADOdIeiGwC7aNRrWsZhc4BN1rHuADWHUF9tRCpNDtop3/ezzaPMjThzUyTuneAkDiZ/Fwuj7uFzehHP238H9k9e/4qR0Cm6oseior3INPLRTKj/zjcfTRhxJs/xhd/M7A8aeyZ+f5/c+coF9Zg1wWG54ISENptIhxcRl/CIYduLXJ3/xpYfSOXgauNIIzaKLPDo2iSuMy/D84KKXvii944Fn0qfveiJ97uF9GCQpvQhrDD5yBpkNhpZffdZDNhpS3jhlPw3SQGUoxKvtHKvfu2zyk8fXPBy90ska/w3PpNubusDz9xS78QPsl+CO3s9fsiu95vwT0q4dG02xbFlNTJkPziLffWRP+ovvPpvOgLw53qXF5rrdN+V1lGflwpBMTryYF4M+SqgoCuF7AXw17JYHn09vxZF8MRKpETtKieByzAYCjoKLzjo+vRLbu594Pn3x20+lOx7Ym76DmxlbcGrgrMBFEUJqr59zUKgoyOrHeiWc6ESjgDNR1FMKfS6d/obzOM7l+IHDNiVxaueVE309iHv0TyPpXPtcgle4fvGcnemiM49Lm3GOZ6l2BBsMM3rH5NPGm+98MG3JB435RdtxIPPrUGhaIVx2Rb/MzlYFDeY74yYseykDSUv4AiSfvm4y/dv/9kA677TteCo16QoyfSuz7ZeBADl05CX4VQu3q390Ln0P57O/uX9PuhOzwv34TBEfQm3DaWI9nORRxHOczUbRk6zAbG6VNf1KQwEemJp8F2qYnAsFsRFjvILRbT/KCfb3J/fOLqXncNt8CriX7Vybrj1ta3rlS3bYq3Rc6LEortUmAx9zpwPuzm89nv7y+8+l8zZP2yv6hZEGWekJUiGCfrQH1/6Lz+b5q2JGGRThPDofwjnsf3vZi9LPYoHHYgKrmFW3mFCaHOXvPXA0PfbMgXTPo8+nu3Dp+W3cVOJbMOugdzNOQfyNok2r0MrZgRv1jyoWkrorZEpCAVij60lLw0HL87gdhbAd61n72dw+2MfnpSfjNxMXHr8uXXDSpvQS/I7yBPyYZhr3RlTcXz9FCLbaWsl//NkD6f/6s6/hFTDnjL7LXtWksDZsbenspdCovAyeCEQ7Jocovgz6Ypx3/uXXnkqnHbcxvf6iUzFzIJF5dDfsK3YZSBYebTSRJ59t+PURNy4c344pdDducz7w5P50/+4D6btPHUzfxbXyXsD5lJI/ieIKeI0lxW11532aNNmmYXjX+mUUOUo0i5Y5DWef5TQPvzmlH8LC6hD85eXbLqxdmPBz8Kr86cdvTCfv3ICfz63pKIuDXP52CFbRoQzOnnwg98//8h47vUxgYM2HJ7RRDO2Og4CzkwU5ExFf1gCV0ZNR+wpAhShofE3sgi3T6Tdvuz/tgMOvOPP4Va8HqrTY8sjTzlh49JyCQcbtCiDo1J79R9OTuPv16LOH0sPYHsEM8ShmJL6zwJ+wc/nAlyd4LubG/moCT9lc5/Cde8aVsrhBhJ2OdiLZZ+9Ym07bsT6ddvyGtGvberyOvba8Lh/tjm2w+9EH2a1/kW5U25IPRj6O/+O/+lb65p4jade6Cf+VNoyDuSXZyk8n+SMED679/c951DOBmEUf+9amJhgih1jTIa5s/8Xbz08X4Ii10Z5pJOeF1kfnFvDFkiW7yXEUK2eOcupiGcetaT54ol5OxSx8Fn4EyX9635H0DAbHHrw4sQdPLw+C9xDgh3DUctYaLphzApg/r16LNccG3IZdh1PNFiR8x4aptAVrnuOR6K1o89V4bvigivHy8piJod8qfFuHNvK1OQ5g2Uk8ExPjKp5RtaZ9Sv+TT9yd/uO3nknnbFmTjsAnFcqLl50x+Wyrr7rwrTQALOCMci6jjOaihr4/hUHw/re8NF12zgnGQWWjeCQz1g/t3p/ufnBP+v7TOLKfP2rnVd45PIyBMA/5tIRBQLz9CEXNdw94Lb0eQd6OI4JH+jokUAGn+TySDyNYj+MKwwZS8Knq51pikI7DDyx3rJ/CrOEYzhpM7BEMpLn5BbNpD27aHIVNz3EKhEVci1Av7WOhjXw7l09DuXjlLfRTt69N5+A3/BeevsMemDFevWaYhLpT8nlA/AmO/Fvu3WOn3qMYzNJHasY5JpowJbsDh2Lap9v+ZQZoE6W+1bSWpcdi0XGK5LxwH6bh911+WnrrZacbixywzgq7/+/O76ff/9Lj9l77etydWGvTNy+nuNii7KbAFupmcjgguPE6mH0uymzwgYU0TA7P1XZplsXI7iiVMwtTyvM8jy26rV9A85n8Eq6O+NI1ZaFriTd+xcesBBMK5fhA9fUS1w37MWPwyP3Nq85NJ+3c6DZSUE9R8mjn088dwjn/W+mrTx5Kp22cxG80usknu/xRsl2szwqSpZq0ou9ZA7gwM0vGqQ6GEu+uOpDO8m8bnb1pKv2zzz+Io/hg+unXvTRtWufXukxMew5m3Ch6H14y+U9ffyq9FM5xkcMp1WVjVEN838xt9uXAUwbX2Hr/oJgLZpdEOdZxhW5y2TMwdkSAkUczj/4iI1NRFWcIv50KIPq8HO6Wts8B7Pf6N+F0ctr4VLoL5+6//vbudN2PYwCA2fzoCumso75x/9Ppxk9+1+4cnjoi+WSnD55Ytn0zI6kDSkryc588LHmic6I4MhQBwWJAZLRGEQWxTcVcMJ2/dU36xL170z/6D3+bvnbfbqIt+RwEMoQwyeQPTl91wob0DE4hLJhd7egZDqehTZe38p4Oo6mNg9E2wFgTDm1VofW7O9oif0jPQaitIwNyLMBd9t5EkoS05OesxFkB395PZ+NU0Fc4W7LwILCD4o770y/f8j08Hh63r7Hw9rFiH/nN7hxb6hNNjTUhGUpHXY2JwEGZp4MA9GQGgJE6nSnzaEUbnCLL4hS1C9fCXID9n//vPen3Pn6XXdNzBpBsGcea8J957RlpM54zPI8FG1+GWE0x20E4ZCnty8XsDW3jyXZEnAJEe2SbZLR9wTt1ltmB5Q6t4c+4vr5nNr33khPTy8/YaRj6Tdt5YLBo9vvrbz2R/uHH7kp/9o2n00twk2cC72kw9cSPLEAV24P/hT7raKM1fv4bf3pGRAqIgkS4YKKhkgiTSa7Te9xzMHM6PQELs289czj95d1PprHZuXQivi/E37BRhhkMWtq2Ye1UugxfH/v6g3txOTdvt4L7pn7aIf0mg4CmCE8w29oaMutG2pUC7P7BL3ukWiWJX3XFeIvrBQb9m1iA/qMf2ZXe/ZozDGGzIVo6KNj/1kN707/63P3p3359ty1st+F2ONbAndI3GEfp7jCiQzobBzkmxA+u+4PPG8w6AcE+y2qEH4uGQeAYfwyvN/Ee/1Xn7UyvvXAXftfuP2umHv68aRwLvwOH59K/+ex96S9wCjkLN5q4cOOLDrGspC/iPPSRs9sWrQUVUeAbUSsVJl8DQInwQeOD2Xghh9ZSNx93P4MrBib3V37i9PSj555gg5500s1n+fcg8Z+6+6n0uUcPpB1YK3Am5EK0eo2FLmLARSgvPWORHNojm6ibRTOLZd2AvigkrlwFXPeHt5PTlHE0wjLirThP7Rc4aKSMMBkhvOoK91ljEqtsLpyewEDYhMu2nzxzW7rszB3pDHxrgO8SqoAk3fHNx9NNX3zU7rqdiGtw8nEcVJmirnXEyXbClLRKWQMg3+UP6RUcwchHGfYtpeK70hyl+jTMAc97Dg/gPsRbTtuc/u5rXmyr/kj55J5D6e6H9qTbv/ds+punj6QduG+wBYm3dQcDEIv5jhzBhgXcgYx2yWfCWrjZnGWJTrFQVgdxAJBIhBTmfVniLCBB8bbT1L4oVUtW7JOfA4HJfAZvF/E7d+dh0XjFWdvSK3CNvGvHhnLf/Dk8D/jzv34w/ft7nk0n4Vp6KwLExZQK5bdOExf1iibSDR214BGeNQeAZLDvm+Zi+k4YNdXCLi83Cedz/pPWT6Sff/Wp6dXn+y94SLkXN6jux5PPL9/3bLod71TsxRrpRCyANzHx4LOJjvqqWGsVG5oBwFi2dshuMpJPg0B54+eAmD/JHFyPGcBV1uSbVOcwA7ij4CKcFjIOxyiFHnRqx5rTOy9DeKNnNwYDr/lfvnNduvjUzemck7ak0/EgZQ1u6tz3+PPpP3/p4fTVJw7aUUI6FsmiM7Ef26SRs4ILZkxhZ3JyNAK40yRNq5cEDMcBnLB59L/zwuPSGy8+xT7f5s8w9qWvP/Rc+jIeaj2KWWEzFrnbkXTeQOPiDhI7OmJHNpGEp0m+3GEwEdF3+BgHbUXVwctTiPN58tT2GSBzyDENAAWKdcFJOuusPILUBgsKd65Q/G0tKt2k4Veu9uBKgLy87n0ZLg9f9ZLtaQuenX/z4b3pc7gTdgh34OzuI6lcUbZF0iqceDqroLEvGKljEQ1hsR1p6LN5RL1qg4BvM5173Pp0+bk7cbt4Gkf6vvSlB55L9+IZxbPwh3cr+TYVB8gCj2TQu+luT/FDyrLs2vWjeRGvdVG/ivyxAQBgxLkP7jsHgAZP9L9/AECQG6TkUZ1llI1VlcpP8u4AktF9gphYXj2w8Ksk+5Ds3QjgKbiaOA+zw/NYVO3FxgETnXV9WSKCx597x6KESrf6olGfdUcWCZpkRB7Rku9UXLLx95NfxTmdp4Pj8UWVjXwOAFvt4RIMlh4X68nhKYk/44qypDOPM+PjdM4kqpBeR36H14V34kNebdLNuvdOIBHd0iQfzsLaLklvbzU0XUYM1LJ65e3X43Du56tiPEd+Bz984AsiuqqInJY4AmhXsI2BiUGPPH1tBbKDgwzzpBkIhJnerO87zx62ZJ+z2b+kxlU4z7i8OcYyyg4enfirXkajHXuynXw6lwvPmnhtBmdecqktAAAnHQca/z6IrwOccJUDQGK9NuO6oP8pPerhVKnCBysc1hUijNeEv/AhNzoxXelZOJSYDgTU7EBwldgNWK8wmfZ+vg2KfmuUWMpXmwn2ZFq+TAdPNnzHYhG4ONDEJ3r2WVaKi1NwwFA+7XLqMgBGmOp8zZ6KS+Goi/2CoCJXUunZF6+PykwSuNSMtA4bTSueWitgrGUHsWrTptImHFsNCyn7igfQPAC/0WNHu3RlwcdJPPIp28PiUknDYj10mHDr59iRXvYYIu8iPOI9+ZTGrVsiXcQYT+NlGQAxidmmyDuyrcC1BMNGVErHeTBbvtofdqziqqwKG24N24BwhYA7B2QRxgyhxvfyRx5J0lC0kx7/eANLhX+FhzLq+ZbUodCtMKuZjdSdS2uz+jJRdEN1liF64dt+zDNpquXiQM1pZ7WFho0qPuKEHSYMfotoxZrOmEMrmOcOO13rvCU/y3A5pGPuffql8hVE99qmARWRhGlxFuFs8xTBGSLGreikMT3FI5f3qKzlhhs1fenn7BHWgGwGiE6UoJmRrrThabrHoImeNpw/aJfO+hm4X3eMo+7eUVfxzfjRh22Eyf+IJ/2oInriYzvS023iJJO12k6HmQI0gqmOMjQcLbnFKXrusjjTQECXpdPr4oZtyDNAv/IqyfFdYYZdUXnlj62qy52ofadq+5E3tlelGkS0mjK1ScaQN6sSODrhksukDpUsmwOCM0OcHQgbNYiqSW5/Sbb8gaIYr9imDZU/WyQ+IVDzrxdkbH+lwHHqWn2JtLHtElxmlSYdFbK6ljkc7C99g3nyW0lFV+Azmt7MdbmHEtXKcEFdJjteOXCGB0+UF9smIMhm08aVbOSgAZH9AARI87vR2nZJo8WpcMzMBHf9g7Z7niIThXQMlUFEdopLrPQ0cjgA0fCO3I6sbkd0VtN5oE1PJmPfSmkI0NTBdvFTZrSJHNIXuZ0m+2Trh7iUcsX01xOk+A5HmXKkuzW3r29Jp2AW2oqKOjijtCX6IT2qI22+CqAoN7AGAcbZc4Nhwy2blNITxAiriqoMyZfjXXq3w3DGUvkIa6dPyjenEASO7lo8Oez3JdDoGPyMpwzjR036lXi6enh/nj+l6+qhPLvtaopgI/XktipdBrIfLbc++NsSbaJ8yhNVvYfQaAEdaThIOkd/hlOHDQDXJ3EEs/gIo8iojBgKY+59IiIE7TAYHDJ6L1o6wsHEvrUp0f5mC/vkrzaRJp47JZ3wAZ7jLyMRMajCu9xh+yhZ4ar6xTVcu5xqjyhoJ5NNGSqkjZvgJHG/HEKOYYmirnWRHZgjn3QVusLKy1G3pYDQiLz1PkCkaNvZUg+CkNVhQY5dU7XzyWjxlOBkktaZbvK7csjb0kuuatne0hFOmOCiE5/XDKK3SNfaHmmdPxNHBNsBLH1FcEvb0zd2GdKD7x4A1WaR9vkWBgDF9yWVgiqcQmR8K1BwKaTHtNfgZjgzBSja4mXyWAzNCBGQ8ZKnWjyZw6vMKxoTJKGFojYow1RmPaavos3Wrp6KpA7iWnzRnUnNF+6s4cDC02vbsMyilfrQERvbxy48XfLjXvywF2wGA/VzpuLTxFjKAKCtRgpNcsidJbmOErYZPhrMdi3iqRC2cnbRkhEV4pSmNwCpU7JK0Ix75de1XJrrCeIE7tS0xe74MarBEelV3WFSx+hNQrGzLx7mL3lAzzaLc3m77IGP64rqs1MUXhOoXuEujcqHH6qM+yf+AtJs1SwaPxYx0Qk4OXJAGARuEmx18ED4ouQFNhRkypWOCKO42odZvHeO1RZzZgOLdnqHAJMhOQY4xs5c6ZFR2GhX7sgO61Knqa7DjGJKsQ4BDowo0nRsDDqGcA7gvpRWlhBFJuTxvcb4PUAoFJnVxJF+IX8xJM8AJKoOkbIINbaaDAocs3vflV5JaXkya5HFQBpXSFzURf4YbMkjjEcJ5wBU3HNnHdHH81/hI00xszQItTLstRA1+RlSKrexdItvglAmbTQ73VihOrVsFLDtE569dJJGVh89Dwh+0zGWjoyMIA1/4EIZNgNQtnLCMLn7nAHI4YEjsQXbgN3ZQTSkLnTs5NKBSVHGeQI5CziAtCxKrHUAU4KHHASOswPPby2fScpyG7VGq92QThB3h4vbJxhN5Okyi5YY852OSF6LF6Hw6rOmv33wSHOsNmXEuI2Sx1hIX1gDhEhZkzsNAldNgf7Y0/sUxGAQznamMph6QzUZKjHQHtyWzmW6UDen+0qTHCWdBgdlRL4ok/BRJcpSW7SRL0qobbT8P5WXQeF8pCqBcZEr2NGnUzATU5UW8A/WqDZ11gCtsOiE54yjlFSaqinIrZJfwpNKeSas8BMBQOUkoL9Qf5sQJruFtdxK2rHoyFdpXYrb30oc7ptt5M8ol+ODWTJj8iusX9YwtAuJdo2SJRtMb2ToijKfJcNmAHYULCFsjCBrlMPkuTy5WwMXZYuXMOMvo1/TYtATGVdoR9s6ZHJQo6yD9I7skW89JAZyOreYKV2RHnoVBa896eSjSdJJwbHdp/tYePEci67iOUviT8jjBymyUTJibXcpuahG7MopgAQSxACYAHhk7RxstVVHoeKnjMhPOPvC9/UtcsdIpGREOVmoVdq5GCXTofKLPcmJsMKbG33Bo8QIj/xqs1ZbMkfWmdYsbeLT5YlaaUTTB4jsDvZfL/M0zfsAfbYw+fYL56wT71364kM/GOgq90GhoAnHaVivQAmmOtLSAO/DaP9vRkUaM57MhVaSQg0c3ZYsOhtlBMocCOmNGG/3BYWYAq/R7JymqL9Tsk2EiVd1h25UB3riMDVed6zDQZDKaPl1rUaaOXwwcgKP+XTdT37CmXzeAyhyINtmAB/d1RwRKMjss+01xfHnVoAxLQxYU8SnOjpBUskTnnLop/TyDhZHsAoHHDfhCVdbMkSrWnh9vSTEUSRDtdFkY+1HGw2TZDqjT/kwxGwfEhYAFqEcpyiDtqtPNCNaSiNXdMKrX5Kc6SmTsZqbm7OcadFubyIBXgp8o+VlEUjVEkqiNrDEucHE5rY1vc2miuS0MhisvgFDmPTzMo8bA+LFHwJx9HJryyhdzB1fH+dP1ClrLX5j7w+x0AnBJY5mxULVe44s2q+Q2I536pwuJz8yjWi3MVA/2u1tHsWS2x1UopUK9SmryBMSteB2eYycN+4ZpTTYCyEusJtIKQlyO5EyfI4c2330ev+co9QSi7tQZlwWWvgoB5vo3CmGnhsKcOS30UzanlJkcVyDhL8feBJ/1vZ8/FrnnB3r7EemAJmdUUKfOL6K/qazttqHn/wTbO6fdPTxtCYpCS1c/eyZuiPrNq7qc+B6nIZZi2wnGklHTru36o65oCI0e1n6QDNwMoDUMZDWbyLDe9L8q1X8ezX6EzRT+KNG5VYl6CmPRxhlWdAoqCnSw1/PgKjBdrs0gZ9l2YvfGvJ3hr9y9QXphM1rMACwbhnB6/67Lfw2xcP4/d5bX3Vqet9bz0734w9l6ZdKXU3q1cEhSIyZYG0tnwiv9PLN6xjrIf4ogE6H0u01OWOsA729SkIDHOisZlCGEV4NlJaqIgoj1vrg4RHLv1RVecnDDVM6cHZPWvSxLu2sIxjLsFC+NjQA6RbS8GNR/NMpv/y28+xjFIfwcy37TUmgLzK67Nbj7HFkdh6fwd2RfuuKF9t3/AlTEa/XDhW2+itqr8VDm9keVcTPsaq20fbwmRzCRwlr4H16bQAokEN2BUA8eAwccJ7YoA3E/tCBMDeP5M7ifU33xBdHskz2nb7rnM0UQCjYlBSdYpvn/YdwBP/iFaenHZvXmVFd26s+KtHi0nWaRPsdn96BfMPFp6YrTt6Y9mIQ9c0EtMUSBSWyy5SO2Ln3FVn1Vpgnvist8hHPjbzt+sTl+YK5T3bV4i38zeca5MqQj/qsxLLRuOcG5T0q8jKZpOXRr0Kw4wSpjvkKNo9BoLnII60HQPRe636/OQ6QghCpmCD+IevLd21MF5/1IkPd+xh+UYwPKvPn2PrkmyHoW2RGm5bx3dfNmC4++bXH7GMN/N7gOy87Fb/w5SmkMhQ7IedYpeu/x4OwFt4np41F23c5OeG8UsKmwdvK6wzRnBePfqB0gQGAMOnIi1BrNxG0ZAPRGik+hio6HumE43Uqj8pYyDOfn145HMEjDRWiSCYfUj6OXw7/xLnH2Vc6if4vX30EP850Lh3t5CPPUOqQTH6hbCc+Y/Nn33k2fevBZ4zxrJO2pkvxLeADvKLQjBX0unTYocYLrGU/ayuqe+S0tBx/hNE3raXEFuNLmA51k5GtHRoARpgFukEeJm9LtNcv1OE+eskVjo5wEHDjHSvWvKbl93FkG49V0mtgmkOwmbdB+e38M3dtNdon9hxIX3hkn32oiit7xVW6VBsxdm4L5IBwO1aSX/7e04biZ2EvOmWzfdGEP/tmYDvBleAsQ/aolnzWrsMa1i79TGQ8aEf5Q/oyLStX3bWn8DZ2ia3gAegdACJkHQ004yh0hGDRt0dwlKc2ZY2iI46nAw4Au/Y3fRyIfuRGmySPK3zM0um0TdNpCz73yvL4swftr5r7nfH21ML0uy/ySzV/jbsJXx//3u6D5U/lnohPvh/GALPDAfZEG9qBZMrjjvZry/Bj8oAuJiqK41FvdhRgsCfYFnWMkrXiAChMND4U6wVYDAZ5mLRRyQ1ijC7yRlxsU58nx6HeDk5nYh7l6zADTOY1yPMH+WduQWf8kuF8ykfXM8n3T9zxYw/z+atcW/D9YAZLsw4po+1t2/o5Gaaf9GSiPU3s2NeGBgVbn0lmPCO9SSAJGz1lFDySFnkgLg+DCCwJD9R9MKKpKI5CCeXo5CKEUzfvAUR+4owLuvi1Kw4Ugky3oaJEAo5dpLdjTGajPsaTxhY6dKNNEd7RlpMgGL/exeSzmO9su0Mur6EXnTHknekKMiJObdeAHuUJGOugt4J5CnAf6Zt8iu1Km1sQTg1+K1jYRjgFxWCJTPUwntM6ziswgsnluZuXg77ap2E0km/v4M/Q48jy+HFtyhEPqUFfdEL6Sg06kss2r/ln2Aa2UOO39/i59m34c3Um1vYu39VwP7rQrnk4shl/hn0Sn3hh2YfZxL5X6ALsh6Xxp+Sjhm6NEX0c1tvCTI4Hpmtg5jUJjBOx3BHQ0CvxRXeOF1mkzyOoH4YQg2KyvFn3VNwoqMgqUEkgqWxa4iBAIH0AkMtHZzGsCKojWAYK5bTUI0itqdM2gtCexhzNv8HHz8vxDzLtwhe5d+EPXPHopYAeEVUYsNLBr4bzw05vPXET/naAT5IP48/XrMdYWMQANjk5LpYI8mbfgsDajLpDm7wWr2CYZJtcIl1b3rtIxsTpyA8a2tJTTAbg/Vhn4Gmt86L4UAIogAqoNG/O2t0P8VGrOUBWHvX+RI9cPli6/P1wCuGsUnXLBk++yzAq2MaZ5xA+JHgPvibGwi+R8mOUT9pHpdwPt5Mcte8yDWQ+ckbi18p+7Fy/l3DwyFy68/t70/G4l8A/DCEbau2yXEJ3T5rOuqGLhqwMKA3vyyeCKYNF+pwi7IEvuNw2bI4/2wWf24bHxTQGwPJ+flGLehzYv+8gs0EtZVTSxfmRSphoWLelhZGkh8wGkA8inj5q4RR9Ir7Mdds9u/EHHnxcX3nJqfaFbv64hTdyXL/XhRNKCGei+Meovo0/VvEz+Nbf2afsMJJvP/Rs+tLThw3HyaQYlflcZk2C++H9osMaXZ9B0UFLDhQEuNpVnuhKDWrX2eWkEMGDQB6BywO+MJIG+3EnMO0ejOGeffFqBFOQQJP6BDMZOrrD4OulpTiTAQNK21oOjzgHKxBVh/FlHlZM4AZ8a/dvkKw78cVtlpPx1zg/fOU56ev4WDMOXnx6He8aEBGSxy4/5cbkfwfJv+z49envvf5cghP/UseffeGB9OJ1+H4vFzjkA5z26chm2+zNcPIB1ClOI5DTk8bgkEtyzWoFbnKzLh95RU+R1CoiwgVU2kxTcgOlfFAHl5/i4+AnbDQsD+BdLW5wdaxiQqtPeUHHY7MAS0MDxIPpqmVghwg6aEvnoCgEOYCZhnScBU7fMJn+6L89mB59er9RXoo/YfPv8VfM+Qu3u587an8+htbxyR83JvKpQ3Ppi/jM2zvP3pFu/DuXpI35D118/Av3pi/ir5RtwhfA+Kk62stLXLMp2+H21Vix327kjDB0wJ1hbBWeLJRVhjmtdQNdV5+TB3lZjMkNbWviaB9gAGC5/vj4uT/5dy8bn1rzqqUF3kbp3hiKCYntLM9lKZMZSDoHMcQc1d0jNpPl0e40oBDYHCwdNBimWFx+PaVEHNuMK98b4Lrhi7iT9yNn7LBP0Z+4fUN6/Xkn4Eges0XiY0g4P0/Lz7vy7xC+5rQt6VffcHa65tVnloXfp7/6/fRPP/9AOhePk/nxZ3ucHJOSfTfrczvaQ3i0n8noFMrKgDa+4o08sS05EUYZ6ps86YOSqomcg6WJ6TVjy/Nztw3e9qFP/eyadRs/OnfkwAKYyn0BKRgyrMfRlpY8kU/tjnFiCrXwFcQRXXvs8O8Sxq9qUvYwn78NtB/37rfhI5O/9rbz8UVyvz1MaUdxg2fPgSPpCP7SGAcL/7r5tk1riyIu9D7+he+l99/xUDoff+PHLv+ApZ64yU/VEjDKJuJlq2rSxtL2jY56Ay/pxc+2eBCZJtFdOtLmsjC9btPE/NH9Nwze9ru3Xji2PH4XFoTUAVkwiFFvDCNjURRx2TjiWnzsR4OjLLZVIs2oNmXqvoL4Yh35JvF06DCO8OcwEH7+0pPSFS8/Ke3cUv9GQeRjm3+m7nuPPJP+w+33pU89st+Sz3cLPDAeFvHoNBBt8RiQwpNKWyxUEEAZLNE+h9S94lUhmd74ffD1JTnSs91H47bkwYZFIN65xDl/8PLBzMzM2NfWXPLdicnpM5cW+NyMr9146TOIwrN/IrM6wj0QrqxPRocRHaNEpBQc1RyIDFzpk7ZnAEQdkZZ6+HIn5d+HReDxuFHwk/gs/YWnbrc/58q/ZE76/TgdPPjUvnTnvU+nWx56Pu3C5d7xuPWrp4iUQ7qiB0Yt4uGUYITbRsLcZjOW1q6IW6lNPm2RzmzJ8RG82CcA6lYvzFsan5weW1qYv+/CQ3eebbG/6oO3/uHkuo3vWTh6cB4MeAyCAkqVPsFG0gyGSMd2t09jJNETWXve6hibnWudp0wddS6fQj3JQbwJJK/RoB7HC5ez+NNtj+E9wWcwK2zEwFiDoc557zk+A0Y5dS3+9iDuIPJpIB/7RPuNIO8olzMAN9KUjfjG75bPLSVdxUhPx3+grQ/7eBi0OHKLr0o6dgunz/mpdRsmccr/yMd/5Q3/wM75S2PLH1ucn30PbtjgXhfPIygKnjU9tK1COz6BElxGsh/bWRyrUOhU5kXDNWSnQSX+UTUHAQtUGa34DRh2mqp5CUdZ/Or4i5F8LhK5+qetLwY9LVjAQu9ofvhjC76sw8RJQdYnuZRJGdroFNssts/t4kf2FFfimcDt58CoUTD2EgPvDe8lk3qKeVmfqEXDvtmFHCPX/Jr6xwwGLbR++aoP3foVXA1csjhnf7utvtIjRlKHIicDyJoRzrZtwNBAx6HlnZa1OCyjWattxMaKAKPD9wqL/Og0eFi4Fz9rJcyQeRdlqy0eyuabTW5z5RJe8ozPcllnJlG3vAWOhoeg70Bx+0W7Ui2bSRN1sR1xkgH44sTUWg6Ar378H//kpSAaTFz+T28fv90/yv0Hk2Pj/2lpYPcDeHI0I8kchUlRhAUFRtvSVJfMbUq0/0N0TJ79J53r7dNDrD1JhKPldGAcxm4t8mlTsoiI8tRua9ERTvmabdjnFuW5Mur1dxjok/xSbTTYAcV9mXmkl9DYbvutHOJVCh+DYvKHZZE2y1jCgTM+P7v0h4Qx95nFWJexFrhrfGr6QtwTwOs3A8wCdJikxy5UwH8MhLXd2w5j64j6ckI1lVJt6XekdOGjdJGXG5NFPxidVp5o+uBS2coXj/BtHenln+qWdrjvwWbMxaN6mHY0RDy0VW3Ui5jhx5cXZu/++D9+48vEbSfSy2c+71P+cvonfleQseomn4IkTMxt7WnzBPGqUsFizRL71uZ5OJ+bjQZkrEfdYhU/iIos8nM2GLU5D+X6GkAyyKdNMNbRHvYpl28maWM/ypIM8bEmTV8dYWwPb9TvvhHndqmuPhO+UnG+oZjj08j4mP3C8j8hL3Ju6z/NAAa4feaKhbd94Nb/PLlu/bXzR/BcFfdTlHTVUtxnREsjWtUtvvSZ0ExkckMfUSg4yWHd6o/92BaPYKpbGYRHnPMRxrkD+rKgYnPux0r8FtRmBlyJL+Jim7LVrzV9d62CyQb1ZUeB4xYHrvImF44c+n9u+bU3v+tdN988/hfXXmsvWZZr/svTHXYtNDt34BfmDh/cg3vF/EN+uCKqUzoVaJPwWJNWm6x0Y9xi4YZqCOnAYj8qiPCgy3VUGWLpyMz0tCvC65EGGzOuHplOG2ekSC851CcbrJ37nClEz5da21mq4iKdH/GUwyK50qUZQv2+OnM6Pz6hiRXz5NyhA3tn58ZuIPC8b39b49kGt9Njz2mBs8CVH/zka8cmpj6LtQDuGGERxPuvPcXeQUfQVDg4ZHCEqd3WfSO25SdPhMW25AmmenVwP7rJw63a7nDK6LMvwtl2XoNy1y2U3YUM9aRjNbXspBDRE1b6yBLXYaX4kizhxs8AuXzdJ9535WeVY9F0Lvceuv3fLV10002Tt7/3+gfOuPzavdPrN795eQF3T6gtfi0S3JrmOIpVZKCMEnyluo+2hbV9yhPMQhyiXOA5MOq7DZ7s2g5yMr3juvuujC4u9kjX2TJSMCAjubBWtzrUj3U8q0imBoILqeKhiaFZnFy7cRw3+P7BX/3GVX/O3H7pl9/ZeQGoMwDI/uTW5ltkAAAEjUlEQVQnPrHEUfKZ33zDl8+6/F1T0xu2/LjdG/ChFYaXK5OB7PUa5WRDezkjfjmivtnfxKviRiWOCTBLSqzFw1rxj22jNlxXmdN4QlvjI45t2qriffW8Jkz+ESJ+x9aQile15KpPVWo7b7cvHebp8vLiJB/4HDpw462/ddUHmdM2+ZRRtUui13hGsIxtsHTV73zq/dPrN71v7vAB3rvi4T4uI1i3M4DEyBg6YTESItSVxoGSy15sD/erzEjX3+6hhUFKmXhUuyXD+odtqNOweH6YmrGwZNRdGTSKk6NsDxy1edta+YjC2ZrrtjEc+YP5w/s/8OmZt78PuRxDLrsjNRtbJWRArTgAkg2Cqz/0yV8an1r7ES5kcEqYhyT7S88MWhwAlXe4pQDTGbVJJefYFlw1YSodWElgT3IzQ6TvaxPWByd7hEs/gDZoir3o5ywUktU2avKq/RXWjQllUmfRm5WoH/mAmp+YnJrkpfzCwux7bvuta/7Ik0/TbQBk7lqtMACMaICpY7wsDNPg5sl1G7bjEhGvXuIVosWlMhtUkf2t3qBmUjnT0sR+XzvCmCAVtirOg1z7TsV+geXkir/Uo+CZQPyyv/CtotEkrsMheaShW7U/nC7D4VwPouXJtRsmFo4e2oObue/+zG+/Cwu+GSzqZ3i5V4PT0QTZTb+3+3NYPHz0hhvm3zBz87bpNRv/5fjkmmvt3f5ZvG6LgQAj8cPc0aIUqF7hI4DDPMOJbGlq32kpmjBuCqZgUlt5BKm14xi7rm+jePrgKyWamkbFzTTmmLY06oMGj68Gy+OTUxN8sRf3+G+enFj+hU/PXLv3op+7afJvP3oD7+WsWLqerUAaLx/edOMtb8Ltug9NTq+/kKeFpbmjS1ggLEIYZgS+OeVi+wKiwQi6Ukjf0sZ+bJMp9tVW3cEz+UWLN0SnOqIjLLYjDdstbmV/W+7aF1+F1FaMCdseUl7XpSUmHmMSd2rWjvGPZSwePXQ3gL96xweuu5USYq6qxP7WqgcA2fnyyO14EIdpxS4l3vjb/+U6CHjv2MTkpbjWxAjEr3gX5hgfu8vEt49hMfdWywRLS85MHisIqrC17gS6Sabjukc6OSOP2tQh+YK1tJ0+ibNhkb5Dw04u3US6TRZYOUe6YP8QToI6Nc7ZmFux5/SlaI2PT+IUPzGNOM+mpcWFr4wtD/7g9t+57s/JejmnfC7UZ2bqtXlH5nDHbBkGrwzJI6ycW9782///pbgd8FPw8o14dHbWxLR/mYM3ipY5Q+CnYKzbYFJLTI60is7jp9khJzsEknSFFswaQ4JRHtvKA5qFvtUVeYSjRPL8zykU3B9+P+Lx+Sa8ucsFnf4S+uLcEdp/L8y6Fe+xf+yvP3j9V7JtWKvNYK3mB+YLsbffglVKsIHAW8hlxC0P3jhzywXLg8VLMXZfjnF7FoJ4ImaA4yFyEwyf7A90PRdGfF87wpidNj+Gb+FNXzJU0121+wbkqHCIZxT+h4DPY2zsx8S5G5F5AofAvWh/A5PvV77we9d/EzB3GzPy5enHx7hI/0F1/Q+HpFQbr38dxQAAAABJRU5ErkJggg==',
//       domain: 'silly.com'
//     }
//   })

//   console.log(`https://${Buckets.PublicConfBucket.id}.s3.amazonaws.com/${templateKey}`)
// })().catch(console.error)

// co(function* () {
//   console.log(yield getLogoDataURI('ubs.com'))
// })().catch(console.error)
