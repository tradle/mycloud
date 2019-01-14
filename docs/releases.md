
## Release Schedule

Releases follow [semver](http://semver.org). A version like `1.9.4` represents `MAJOR.MINOR.PATCH`

In between releases, there are release candidates, which are like experimental pre-releases for those who like to live on the bleeding edge.

Release candidates end with `-rc.X`, e.g. `1.9.0-rc.1000`

Release candidates come *before* the version they're a candidate for:

`1.9.0 > 1.9.0-rc.1000`
`1.9.1-rc.0 > 1.9.1`
`1.9.1-rc.20 > 1.9.1`

A sample timeline goes like this, with releases in bold:

**1.8.3** (supposedly stable release)
1.9.0-rc.0 (release an experimental new feature)
1.9.0-rc.1 (oops! fix a big)
...
1.9.0-rc.139 (don't see any bugs...let's release an update)
**1.9.0** (yay!)
1.9.1-rc.0 (not yay. Fix a bug)
**1.9.1** (fix works, release to public)
...more fixes
1.9.13
1.10.0-rc.0 (release an experimental new feature)
1.10.0-rc.1 (fix a bug)
1.9.14-rc.0 (backport the bug - not available at the moment)
**1.10.1** (release fix)
**1.9.14** (release backported fix)
1.10.1-rc.1 (fix a bug)
...
