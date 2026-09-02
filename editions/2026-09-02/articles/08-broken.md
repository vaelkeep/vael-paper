---
id: 08-broken
headline: This Article Has Malformed Frontmatter
deck: [unclosed bracket
section: science
byline: The Vael Desk
priority: 5
  span: 1col
---

This article exists to exercise the warning path. Its YAML frontmatter is
deliberately invalid — an unclosed flow sequence and an inconsistently indented
key. The scanner should record a warning and the edition should still print.
