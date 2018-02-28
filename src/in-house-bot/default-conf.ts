import { IConf } from './types'

export const defaultConf:IConf = {
  "bot": {
    "products": {
      "enabled": [
        "nl.tradle.DigitalPassport",
        "tradle.CorporateBankAccount",
        "tradle.LifeInsurance",
        "tradle.MortgageProduct",
        "tradle.crs.Selection"
      ],
      "autoApprove": false,
      "plugins": {}
    }
  },
  "style": {
    "_t": "tradle.StylesPack",
    "backgroundImage": {
      "url": "https://s3.amazonaws.com/tradle-public-images/blue-underwater-gradient-opacity-15.png"
    },
    "logoNeedsText": true
  }
}
