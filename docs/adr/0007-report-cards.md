# ADR 0007 — Report cards

- **Status:** Accepted
- **Date:** 2026-10-13
- **Phase:** 9 (Report cards)

## Decisions

### Rendered on the server with PDFKit

A report card is produced by the API as a PDF (`report-card.pdf.ts`), one A4
page per learner, laid out by hand so content can never spill onto a second
page. A class's cards are one document with a page per learner, capped at 300
cards per request. Nothing is rendered by a headless browser, which keeps the
API image small and the output identical everywhere.

### A presentation of the compiled snapshot

Cards are built from `results` rows; nothing is recalculated. Which positions
appear follows the school's policy at the time of rendering.

### Provisional until published

Staff can preview cards as soon as results are compiled; every such card
carries a "PROVISIONAL" watermark and footer. Parents and students can only
ever obtain cards of **published** examinations (ADR 0010).

### Remarks have owners

The class teacher's remark may be written by that learner's class teacher, or
by senior staff who oversee results; the principal's remark only by holders of
`results:approve`. Both are locked on publication and every change is audited
with its before and after.

### Private delivery

PDFs are sent with `Cache-Control: no-store`. The web application fetches them
with the user's token and shows them from an in-memory `blob:` URL, so a
report card never has an address that could be shared or cached. Every
download is audited.

### One font for every generated document

Report cards, invoices, receipts and statements are set in **Noto Sans**,
bundled in `apps/api/assets/fonts` under the SIL Open Font License
(`OFL.txt`) and embedded in each PDF. It covers Latin with its accented and
extended letters (including the ʼ and ũ of Kenyan names), Greek and Cyrillic,
and typographic punctuation. The shared code is in `common/pdf`.

## Limitations

- Scripts the font does not cover — Chinese, Japanese, Korean, Arabic,
  Devanagari and others — are replaced with `?` rather than drawn as empty
  boxes. Right-to-left scripts would also need text shaping, which PDFKit
  does not do; supporting them means adding a font per script and a shaper.
- A school logo is embedded when it is PNG or JPEG; WebP logos are skipped.
- The grading key is printed only while the class still uses the scheme the
  result was compiled with, because results store the scheme's name, not its
  boundaries.
