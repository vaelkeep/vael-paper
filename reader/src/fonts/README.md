# Fonts

Both faces are self-hosted rather than linked, so the paper renders identically
offline and — more importantly — so the pagination engine can measure against
the exact metrics it will render with. See `layout/measure.ts`.

| Family | Licence | Source |
|---|---|---|
| Source Serif 4 | SIL Open Font License 1.1 | Adobe, via Google Fonts |
| Playfair Display | SIL Open Font License 1.1 | Claus Eggers Sørensen, via Google Fonts |

The OFL permits redistribution, including bundling with an application, so long
as the fonts are not sold on their own and any modified version is renamed.
These are unmodified, Latin-subset builds. Full attribution is in
[`NOTICE`](../../../NOTICE) at the repository root.

`fonts.css` is generated: each face is a variable font covering its whole weight
axis, so one file serves every weight the paper uses.
