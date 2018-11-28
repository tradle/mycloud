## Versioning

*Note: this is generally done by the Tradle team, with the Tradle MyCloud. Users of MyCloud typically only consume updates, using tradleconf*

Questions answered below:

- how are new MyCloud versions created?
- how are new MyCloud versions distributed?
- what versioning conventions are followed?
- what are "release candidate" versions?
- what are "transition" versions?

### The Versioning Process

There are several steps to deploying new versions:
1. Create a new release
1. Deploy it to the cloud
1. Announce the new version to other MyClouds (see [deployment](../src/in-house-bot/deployment.ts) module's `handleStackUpdate`)
1. Generate templates / copy lambda code to region-local buckets for MyClouds that request updates to a given version (not necessarily the latest version)
1. On the child MyCloud side, request an update, and apply it (via [tradleconf](https://github.com/tradle/tradleconf))

### Create a New Release

MyCloud versions follow semantic versioning conventions, where the version is of the format `major.minor.patch` with alpha/beta/release candidate/transition versions denoted by suffixes, e.g. release candidate `1.2.2-rc.0` or transition version `1.2.2-trans.0`

The scripts below use [standard-version](https://github.com/conventional-changelog/standard-version) to update package.json, create a git tag, and generate a changelog for the new version.

```sh
# create a patch version release (e.g. 1.2.5 -> 1.2.6)
npm run release:patch

# create a minor version release (e.g. 1.2.5 -> 1.3.0)
npm run release:minor

# create a major version release (e.g. 1.2.5 -> 2.0.0)
npm run release:major

# create a release candidate patch version (and similarly for minor / major)
npm run releasecandidate:patch

# create a transitional version
npm run releasetransition
```

### Release Candidates

Release candidates are versions with features that are experimental, and potentially unstable. They may contain experimental bug fixes, experimental features, etc. Once a release candidate stabilizes, a regular version is released.

### Transitions

Transition versions are versions that form a bridge to an incompatible next version. These can be necessary for various reasons:

- a cloudformation update cannot be performed in a single `updateStack` operation. For example version `1.3.0-trans.0` [disabled auto scaling](https://github.com/tradle/serverless/commit/0e9a6d39f824362815df2308503b7a407caba78a), followed by `1.3.0`, which [re-enabled](https://github.com/tradle/serverless/commit/5477be5b2d1ce0d28748280cd3a20a55fae16b09) it, because after a [fix](https://github.com/tradle/serverless/commit/0e3b88c8f9947a43239d299dd66eaeca5499a711) in child MyCloud template generation, CloudFormation didn't allow renaming autoscaling targets and policies in one go (the advice from AWS was to delete/recreate them).
- a database schema change must be applied
- more to follow...

A MyCloud owner that wants to update to a version past an unapplied transition version will be guided through a 2-step update. See below the flow for updating to 1.3.0 from 1.2.1 (using `tradleconf`):

```sh
? Choose a version to update to 
1.3.0 # user input
you must apply the transition version first: 1.3.0-trans.0
? apply transition tag 1.3.0-trans.0 now? Yes
 ✔ load update 1.3.0-trans.0 (grab a coffee)
 ✔ validate update
 ✔ apply update (be patient, or else)
 ✔ load update 1.3.0 (grab a coffee)
 ✔ validate update
 ✔ apply update (be patient, or else)
```
