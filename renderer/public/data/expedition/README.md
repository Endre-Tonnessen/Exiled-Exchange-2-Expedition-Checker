# Expedition rune data

Two files, fetched at runtime by `renderer/src/web/expedition-check/rune-value.ts`
rather than bundled into the app. They are very different kinds of thing and
should be treated differently.

## `rune-combinations.json` — game data

A scrape of poe2db.tw's Runeshape Combinations recipes: 314 entries, each a
reward name plus the **ordered** list of runes that produces it.

```json
{ "name": "Adaptive Alloy", "level": 0, "quantity": 0, "tier": "Lv30-74",
  "runes": ["earth", "rebirth", "stone"] }
```

That ordering is what makes identity resolution possible at all: the panel
never names the runes it displays, but reward name + cell position identifies
one exactly. See `rune-identity.ts`.

This is a **fact about the game** and can be re-derived from poe2db at any
time. It goes stale when GGG changes recipes, so re-scrape after a major patch
rather than trusting it indefinitely. It arrived here by way of
`ocr-playground/rune-combinations/`, which records the fetch details and the
one-time authorization under which the original copy was taken.

## `rune-ratings.json` — opinion, and meant to be edited

**Not game data.** A judgement about how much you want each rune propagated
through the rest of an Expedition chain, seeded from community write-ups
because this repo's owner is not an expert in the mechanic — which is the whole
reason the feature exists.

Six runes are rated; every other rune is deliberately absent and displays as
**unrated** rather than defaulting to neutral. A wrong rating here is worse
than no rating, because it would tell you to take a trap.

It lives in `public/data/` specifically **so it stays editable in an installed
build**. Bundling it would put it out of reach of the person most likely to
disagree with it. Each entry carries a `why`, a `source`, and an honest
`confidence`; the full provenance, including which claims are well-supported
and which came from search summaries behind a 403, is in
`ocr-playground/rune-value/SOURCE.md`.

Expect ratings to shift between patches — the `oath` entry already notes a
signalled rework. Re-check after a major update.

### Editing it

Add or change an entry under `runes`:

```json
{ "id": "power", "rating": "good", "why": "...", "source": "...", "confidence": "..." }
```

`rating` must be one of `great`, `good`, `neutral`, `poor`, `trap`. Remove an
entry entirely to put that rune back to `unrated`. The file is read once at
startup, so restart the app (or reopen the overlay) after editing.
