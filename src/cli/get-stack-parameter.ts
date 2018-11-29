
import { getVar } from './get-template-var'

export const getStackParameter = name => getVar(`stackParameters.${name}`)
export const parameterExistingDeploymentBucket = () => getStackParameter('ExistingDeploymentBucket') || ''
