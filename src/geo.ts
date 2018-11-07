import countries from '@tradle/countries'
import Errors from './errors'

const E164_REGEX = /^\+?(\d+)$/
// https://docs.aws.amazon.com/sns/latest/dg/sms_supported-countries.html
const REGIONS_WITH_SMS = [
  'us-east-1',
  'us-west-2',
  'us-west-2',
  'eu-west-1',
  'ap-northeast-1',
  'ap-southeast-1',
  'ap-southeast-2',
]

export interface Country {
  cca3: string
  title: string
  awsRegion?: string
  callingCodes?: string[]
}

type CountryMapper<T> = (country: Country) => T

export const getClosestRegion = ({ regions, region }: {
  regions: string[]
  region: string
}) => {
  const parsedRegion = region.match(/(.*?)-\d$/)
  if (parsedRegion) {
    const main = parsedRegion[1]
    return regions.find(candidate => candidate !== region && candidate.startsWith(main))
  }
}

export const getClosestRegionWithSMS = (region: string) => {
  if (REGIONS_WITH_SMS.includes(region)) return region

  return getClosestRegion({ regions: REGIONS_WITH_SMS, region })
}

export const findCountry = (mapper: CountryMapper<boolean>) => Object.keys(countries)
  .map(id => countries[id])
  .find(mapper) as Country

export const DEFAULT_REGION = 'us-east-1'
export const getCountryByCallingCode = (code: string):Country =>
  findCountry(({ callingCodes=[] }) => callingCodes.includes(code))

export const getAWSRegionByCallingCode = (callingCode: string) => {
  const country = getCountryByCallingCode(callingCode) || {} as Country
  const { awsRegion=DEFAULT_REGION } = country
  return getClosestRegionWithSMS(awsRegion) || DEFAULT_REGION
}

export const parseE164 = (phoneNumber: string) => {
  const digits = phoneNumber.match(E164_REGEX)[1]
  const callingCodeCandidates = [digits.slice(0, 3), digits.slice(0, 2), digits.slice(0, 1)]
  const callingCode = callingCodeCandidates.find(callingCode => !!getCountryByCallingCode(callingCode))
  if (!callingCode) {
    throw new Errors.NotFound(`calling code for number: ${phoneNumber}`)
  }

  return {
    callingCode,
    number: digits.slice(callingCode.length),
  }
}

export const getAWSRegionByPhoneNumber = (phone: string) => {
  try {
    const { callingCode } = parseE164(phone)
    return getAWSRegionByCallingCode(callingCode)
  } catch (err) {
    return DEFAULT_REGION
  }
}
