# Expedition Price Check — adding poe2scout as a second price source

Status: **not implemented, this is a plan**. Written for whoever (human or agent)
picks this up - read [EXPEDITION_CHECK.md](./EXPEDITION_CHECK.md) first for the
feature's overall architecture; this document only covers the one addition.

## Why

Expedition Price Check currently prices everything through poe.ninja
(`renderer/src/web/background/Prices.ts`'s `getFlatPriceEntries()`, already used
app-wide, not specific to this feature). poe.ninja's numbers are the *latest
listed* price - can be momentarily skewed by one absurdly high/low listing.

A comparable standalone tool for this exact panel supports both poe.ninja and
[poe2scout](https://poe2scout.com) (24-hour averaged prices, more stable) as a
user-selectable source. That's the feature this document plans to add here.

## The blocker that turned out not to be one

The obvious concern: can the renderer even reach poe2scout's API at all?

Checked directly (`curl` with an `Origin` header) - **poe2scout's API
(`api.poe2scout.com`) sends no CORS headers**. A direct `fetch()` from the
renderer would be blocked by the browser, exactly like it would be for
poe.ninja's own API directly (which is *why* `Host.proxy()` exists at all).

`Host.proxy()` is backed by `main/src/proxy.ts`'s `HttpProxy` class, which only
forwards requests whose host appears in its hardcoded `PROXY_HOSTS` allowlist -
anything else gets `req.destroy()`'d. `api.poe2scout.com` is not currently on
that list.

**This is not an external dependency problem.** `main/src/proxy.ts` is this
fork's own source file, not upstream Kvan7/EE2 infrastructure - adding a host to
`PROXY_HOSTS` is a one-line change fully within this repo's control:

```ts
const PROXY_HOSTS = [
  // ...existing entries...
  { host: "api.poe2scout.com", official: false },
];
```

That's the entire "blocker." Everything else below is ordinary feature work.

## What's still unknown: poe2scout's actual endpoint/schema

Research so far (this session), so the next attempt doesn't repeat it:

- Public API root: `https://api.poe2scout.com`. Swagger UI reportedly at
  `/swagger` (per poe2scout's own GitHub README), confirmed the path redirects
  (`/swagger` -> 301 -> `/swagger/index.html`, HTTP 200), but the underlying
  `swagger.json`/`swagger.yaml` URL it loads couldn't be pinned down by guessing
  common ASP.NET Core paths (`/swagger/v1/swagger.json` -> 404, several other
  guesses also 404).
- Route prefix is `/api/` - confirmed because `/api/leagues` returns **HTTP 400
  `"Invalid realm."`** (a real route, just missing/wrong a required parameter),
  whereas made-up paths return a bare 404. This strongly suggests a `realm`
  query param, likely `poe2` - matching the same convention this app's own
  `Leagues.ts` already uses when calling PoE's official trade API
  (`realm: AppConfig().realm`).
- The poe2scout GitHub org's own description of its codebase layout was
  inconsistent between sources checked (one reference described a Python-style
  `packages/backend/src/poe2scout/...` layout, the repo's own README describes
  a `.NET` `net/Poe2scout/Poe2scout.Api` layout) - possibly a past rewrite,
  possibly a stale secondary source. Don't trust either without checking the
  live repo state first.

**Recommended next step, before writing any fetch code**: determine the
endpoints from poe2scout's own API and documentation, and confirm the
response shape against a live call through the proxy. That is more reliable
than reverse-engineering the API blind via endpoint-guessing.

## Implementation plan

1. Add `api.poe2scout.com` to `PROXY_HOSTS` in `main/src/proxy.ts` (touches
   `main/src/**` - triggers the usual dev-mode Electron restart).
2. Determine poe2scout's real endpoint(s) covering the categories this feature
   needs (Currency, Runes, Expedition, Verisium, UncutGems or their poe2scout
   equivalents) - per above.
3. New module (e.g. `renderer/src/web/background/Poe2Scout.ts`) mirroring
   `Prices.ts`'s existing `usePoeninja()` shape: a `createGlobalState` singleton,
   the same kind of throttled/cached fetch-on-interest pattern
   (`UPDATE_INTERVAL_MS`/`INTEREST_SPAN_MS`/`RETRY_INTERVAL_MS`), calling
   `Host.proxy("api.poe2scout.com/...")`.
4. Map poe2scout's response into the *exact same* `FlatPriceEntry` shape
   (`{name, variant, primaryValue, detailsId}`) `getFlatPriceEntries()` already
   returns. If this mapping is done correctly, `price-match.ts`,
   `resolveGemKey()`, and `WidgetExpedition.vue`'s row-building logic need
   **zero changes** - they only ever consume the flat shape, never poe.ninja
   specifically. This isolation already exists; the new source just needs to
   conform to it.
5. A source-selection setting on `ExpeditionWidget` (e.g.
   `priceSource: "poe-ninja" | "poe2scout"`), a control in
   `settings-expedition.vue`, and a branch in `WidgetExpedition.vue`'s
   `buildRows()` choosing which `getFlatPriceEntries`-equivalent to call.
6. Verify by comparing resolved prices for the same real capture against both
   sources side by side, before considering it done - same "validate against a
   real screenshot, not just in theory" standard the rest of this feature was
   held to.

## Effort estimate

Small-to-medium - comparable in size to the original `getFlatPriceEntries()`
addition already in this codebase for poe.ninja. The only real risk is getting
poe2scout's schema right; there is no architectural blocker, since the proxy
allowlist is fully within this fork's own control.

## Out of scope for this document

The color-coded value display (green/yellow/red by relative rank) is a
separate, unrelated feature - it works the same regardless of which price
source is active, since it only needs each row's already-resolved numeric
value. Not covered here.
