const plugins = {
  'customize-message': {
    'tradle.FormRequest': {
      'tradle.PhotoID': 'Please scan your **ID document**',
      'tradle.Selfie': 'Please take a selfie to prove this is your document. Center your face.',
      'tradle.Residence': {
        'first': 'Thank you. Now I need you to provide your **residence** information',
        'nth': 'Thank you. Do you have another **residence**? If yes, tap Add, otherwise tap Next'
      },
      'tradle.KYCSponsor': 'Please have someone confirm your ID, such as a relative, employer, etc.',
      'tradle.MyCertifiedID': 'We need your Certified ID'
    },
    'tradle.Confirmation': {
      'tradle.Remediation': 'Thanks for importing your data!'
    }
  }
}

export {
  plugins
}
