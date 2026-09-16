// Text-level repairs applied to Windows OCR output before anything downstream
// sees it. Deliberately a module of its own, importing NOTHING: WindowsOcr.ts
// pulls in `electron`, which cannot be loaded in a plain test process, and these
// rules are the part most worth testing - they are pure string in, string out,
// and each one encodes a specific misread observed in a real capture.
//
// Ported from ocr-playground/combo-logic.js, where these tests first lived (see
// tests/combo-logic.test.mjs there). They were dropped rather than ported when
// the rune work moved into this fork, which left this fix - the one that decides
// whether "1x Chaos Orb" is read as a quantity at all - with no coverage.

// Observed consistently across every real test capture: Windows' recognizer
// substitutes look-alike letters for the digits "1" and "0" specifically in the
// leading quantity-prefix token ("1x" -> "IX", "10x" -> "IOX"), never elsewhere in
// a line. Safe to fix with a line-start-anchored regex; a global I->1/O->0 replace
// would corrupt real item names instead (e.g. "Orb"). See ocr-playground/README.md's
// "Windows OCR (native)" section for how this was found.
export function normalizeQuantityPrefix(line: string): string {
  return line.replace(
    /^([IO]+)X\b/,
    (_, digits: string) => digits.replace(/I/g, "1").replace(/O/g, "0") + "x",
  );
}
