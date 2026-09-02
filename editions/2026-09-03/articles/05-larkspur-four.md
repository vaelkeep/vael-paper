---
id: 05-larkspur-four
headline: Larkspur 4.0 Ships With the Incremental Compiler You Have Been Waiting For
deck: Full rebuilds are gone, the migration is mostly mechanical, and the one breaking change is the one you already worked around
section: technology
byline: The Vael Desk
priority: 2
span: 2col
sources:
  - name: Larkspur project
    url: https://larkspur.example/blog/4-0-released
    title: Larkspur 4.0
  - name: Larkspur migration guide
    url: https://larkspur.example/docs/migrate/3-to-4
---

Larkspur 4.0 was released overnight, and the headline feature is the one the
project has been promising since the 3.2 roadmap: an incremental compiler that
rebuilds only what changed. The announcement claims a ninety per cent reduction
in rebuild time on their reference project, which is the sort of number that
means "a lot" and should be read as nothing more precise than that.

There is one breaking change. The `resolve()` hook now returns a promise
unconditionally, where 3.x returned a value when it could. This is the
behaviour your build script has been defending against since March, with the
`await`-either-way wrapper — so the change should be invisible to you, and the
wrapper can be deleted once you have upgraded.

The migration guide is short and mostly consists of running the codemod. The
project's own note of caution is that plugins compiled against 3.x will load
but may resolve out of order; two of the three plugins in your configuration
have already published 4.0-compatible releases, and the third has an open pull
request.

This is worth doing this week rather than eventually. The Henley build is the
slow one, and it is the one you will be sitting in front of on Friday.
