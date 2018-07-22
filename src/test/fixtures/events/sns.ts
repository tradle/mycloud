const Message = JSON.stringify(require('./parsed-log-event.json'))

export = {
  "Records": [
    {
      "EventVersion": "1.0",
      "EventSubscriptionArn": "arn:aws:sns:us-east-1:12345678902:abcd-uuid",
      "EventSource": "aws:sns",
      "Sns": {
        Message,
        "SignatureVersion": "1",
        "Timestamp": "1970-01-01T00:00:00.000Z",
        "Signature": "EXAMPLE",
        "SigningCertUrl": "EXAMPLE",
        "MessageId": "95df01b4-ee98-5cb9-9903-4c221d41eb5e",
        "MessageAttributes": {},
        "Type": "Notification",
        "UnsubscribeUrl": "EXAMPLE",
        "TopicArn": "arn:aws:sns:us-east-1:12345678902:tdl-example-ltd-dev-alerts",
        "Subject": "TestInvoke"
      }
    }
  ]
}
