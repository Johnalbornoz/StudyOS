# StudyUS visual quality

StudyUS's visual language favours precision, structure, clarity, intentional alignment and restrained sophistication. It rejects casual rotation, visual randomness, playful misalignment and decorative distortion.

Motion is allowed, and so is intentional asymmetry. Static elements must never look accidentally misaligned. **Precision before decoration.**

## Rules (enforced where measurable)

- **Shared edges.** Elements meant to share an edge share the same computed coordinate. The public landing uses one content edge (`--lp-inline`) for the header, every section and the footer. The hero and every split section share one grid (`--lp-cols`, `--lp-gap`).
- **Spacing.** Repeated gaps use the spacing tokens (`--space-*`). A raw pixel is allowed only when it is derived, for example centring a dash on a line (`0.775em` = half of `line-height: 1.55`), or when it is functional, such as scrollbar clearance.
- **Equivalent geometry.**
  - Buttons of one type share a height. `.btn` is 40px (44px on touch), `.btn-lg` is 52px.
  - Chips share one geometry: 24px tall, `0 var(--space-3)` padding, 12px type.
  - Progress segments share width and height, and each label starts on its bar.
- **No decorative transforms.**
  - `rotate`/`skew` are allowed only for a state change, such as a disclosure chevron.
  - `translate` is allowed only for functional centring, such as a touch hit area.
- **No nudges.** No manual top/left offsets, negative margins or absolute positioning used only to "look aligned". Where an offset is unavoidable, it is derived and commented (the metadata separator slot).
- **Optical checks.** Icons sit on their text's line centre, captions centre on their object, and a sentence in a headline never breaks mid-sentence.

## How it is checked

- `tests/unit/ux2-experience-foundation.test.ts` ("UX-2 precision") fails the build if any of these return:
  - a rotation, skew or decorative translate
  - a transform on the hero card
  - a negative-margin nudge
  - arbitrary px spacing
  - divergent chip geometry
  - a translucent header
- `scripts/ux/landing-geometry-audit.js` is a browser snippet that measures the rendered page (edges, columns, captions, tracks, card rows, component geometry, overflow). Run it at 1440, 1024, 768, 430 and 390; certification requires `pass: true` at every width.

A pixel-diff screenshot suite was not added: the repository has no Playwright or browser runner, and adding one (plus browser downloads) for UX-2 alone was judged out of proportion. The two checks above catch the defect classes that occurred: tilt, broken shared edges and layout displacement.
