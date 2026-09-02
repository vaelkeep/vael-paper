---
id: 02-on-quiet-machines
headline: On Quiet Machines
deck: What we notice, and when
section: comment
byline: The Editor
priority: 2
span: 2col
---

The machines had been quiet for three days before anyone noticed. It was not
the silence that unsettled them, but the particular shape of it — the way a
room goes still when a refrigerator you had stopped hearing finally switches
off.

We are poor at noticing absence. Our attention is a difference engine; it
reports changes and suppresses constants, which is an excellent design for an
animal that must detect a predator against a background of grass and a terrible
one for a person trying to audit their own infrastructure.

This is why the failures that hurt are rarely the loud ones. A loud failure
recruits attention automatically and is therefore, in an important sense, already
half-solved. The dangerous failure is the one that removes something — a check
that stopped running, a log that stopped being written, an alert that stopped
firing because the thing that fires it also died.

The remedy is not more vigilance. Vigilance is a finite resource and we spend it
badly. The remedy is to arrange for absence to make a noise: a heartbeat that
must arrive, a counter that must increase, a nightly job whose silence is itself
the alarm. Build systems that complain when nothing happens, because nothing is
precisely what you will fail to see.
