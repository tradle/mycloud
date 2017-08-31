

how webhooks work:

  lambda listens to queue table
  event from queue comes in:

  // message 2-5 from 'bob' are available for processing by business logic
  {
    queue: 'receive:<sender>',
    old: {
      author: 'bob',
      seq: 1
    },
    new: {
      author: 'bob',
      seq: 5
    }
  }

  // get webhooks
  const webhooks = getWebhooks({ event: 'message' })

  // for each webhook
  call webhook executor Lambda with InvocationType Event

  if (!event.isScheduled && webhook.scheduledRetry) {
    // defer to the scheduled invocation
    return
  }

/*
  if (webhook.seq >= event.seq) {
    // already delivered this
    return
  }
*/

  // webhook executor lambda
  // set dirty flag if not set
  yield ensureDirtyFlag(webhook)

  try {
    yield deliverEvent({ event, url })
    webhook.seq = seq
    yield saveWebhook(webhook)
  } catch (err) {
    yield updateFailureCount(webhook)
    yield scheduleRetry({ event, url, delay: ... })
  }

  // dead letter queue
  take all failed webhook calls and requeue them
  same as from first lambda
