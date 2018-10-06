## Data Import

### Generate Data Bundle & Claim

1. Prepare a bundle to be imported. Here's one that is known to work: https://github.com/tradle/serverless/blob/master/src/test/fixtures/data-bundle.json

2. Use `tradleconf` to upload the bundle to a remote MyCloud (e.g. Friendly Bank):

`tradleconf --remote create-data-bundle --path /path/to/bundle.json`

The response should have a key, e.g.:
```json
{
  "key": "..gibberish.."
}
```
  
3. Use `tradleconf` to create a claim stub for the bundle, and a QR code that can be used to claim it:

`tradleconf --remote create-data-claim --key "[above key]" --claim-type bulk --qr-code /path/to/write/qrcode.png`

This will generate a QR code at the specified path. Open the shit out of that QR code and scan it to claim the data. Yahoo!

In production, this claim will be one-time use, but for now, you can wipe your device and scan the same QR code with a new user.
