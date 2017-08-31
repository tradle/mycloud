
  // Lambda 1
  // conditionally update cursor
  const { inOrder } = yield {
    // idempotent cursor update
    // SET seq = :seq
    // Condition: seq === :seq - 1
    inOrder: Messages.setLatestReceived({ from, seq: message.seq }).then(() => true, err => false),
    put: Messages.putMessage(message)
  }

  if (!inOrder) return

  yield enqueueWebhookCall(message)
  // we may already have more messages
  // that arrived out of order
  const batch = readNextMessageBatch({ from, gt: seq, lt: seq + BATCH_SIZE })


  try {
    yield triggerMessageEventWebhookCall(message)
  } catch (err) {
    try {
      yield scheduleMessageEventWebhookCall(message)
    } catch (err) {
      // hmm...
    }
  }

  // Lambda 2
  // trigger message webhook call

  try {
    callWebhook(message)
  } catch (err) {
    reschedule(message)
    return
  }

  const next = getMessageAfter(message)
  // invoke self


// atomically increase counter if 

if (latest + 1 === message.seq) {
  // update latest
  // queue this message for consumption by webhooks
}


// consumer controls S3 bucket with config
config has:
  registered webhooks in lambda
  styles

webhooks -> batch
websockets?
