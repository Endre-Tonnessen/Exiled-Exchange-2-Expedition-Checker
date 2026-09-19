# Expedition / Runes of Aldur — league mechanic reference

Background reading for whoever (human or agent) next extends this fork's Expedition
tooling. This is **game-knowledge**, not code documentation — see
[EXPEDITION_CHECK.md](./EXPEDITION_CHECK.md) for the widget that OCRs the panel this
document describes. Its sibling [EXPEDITION_STRATEGY.md](./EXPEDITION_STRATEGY.md)
covers how to *play* the mechanic profitably — what to buy and what to skip — where
this doc covers how it *works*. It exists because the current widget only prices the *reward* on
each row; the mechanic also has a second, currently-untracked axis (which runes each
row carries forward) that this doc lays the groundwork for reasoning about.

**Status caveat:** Path of Exile 2 is still in Early Access and this system was
substantially reworked in patch 0.5.0 (2026-05-29). Treat numbers/specifics here as
"true as of 0.5.x, verify before relying on for a release" rather than permanently
fixed game design — GGG has already announced further Oath Rune balance changes (see
Known community pain points, below). Sourced from official patch notes plus several
community guides and wikis, cross-checked against each other where they overlapped;
sourcing is noted per section. One section (rune tier list, see below) is additionally
cross-checked against a third-party tool's shipped game-data file — flagged inline.

## 1. Two different things are both called "runes" in PoE2 — don't conflate them

This tripped up multiple sources during research (some guides answer questions about
one system while claiming to describe the other). PoE2 currently has two unrelated
rune systems:

1. **Socketable equipment Runes** (Iron, Desert, Glacial, Storm, Body, Mind,
   Rebirth-the-affix-rune, etc.) — slotted into weapons/armour like Path of Exile 1
   runes, with **Lesser / Normal / Greater / Perfect** power tiers. Nothing to do with
   Expedition.
2. **Ezomyte Runeshapes** (Adaptive, Arcane, Bond, Celestial, Opulent, Power, Oath,
   Tempest, ... 34 named shapes total) — the glyphs used in Expedition Remnant
   crafting and the subject of this document. These use a **blue / purple / gold**
   color-tier system, unrelated to Lesser/Normal/Greater/Perfect.

The league's name, "Runes of Aldur," nominally covers both, but the reward-panel /
succession mechanic this project cares about is entirely about **Ezomyte Runeshapes**
(system 2).

## 2. The core loop: Ezomyte Remnants

*(Sources: [Mobalytics — Runes of Aldur](https://mobalytics.gg/poe-2/guides/runes-of-aldur),
[expcarry.com guide](https://expcarry.com/poe-2-runes-of-aldur-guide),
[aoeah.com — Rune Remnant Recipes](https://www.aoeah.com/news/4606--poe-2-05-rune-remnant-recipes--runic-remnants-farm))*

- Exploring a zone (campaign or Atlas) turns up **Ezomyte Remnants** — stone/rock
  structures with a number of empty rune slots. Slot count ranges **2–10**; higher
  counts are rarer and unlock rarer/longer crafting recipes. Higher-tier maps and
  ocean/Grand Expedition zones are where 8–10 slot remnants show up.
- Filling a Remnant's slots with Runeshapes and detonating it (i) crafts/grants the
  item that recipe produces, and (ii) spawns monster waves empowered by the runes you
  used, which you must clear to actually collect the reward. **One Runeshape used =
  one wave**; each extra Runeshape in the recipe adds another wave and layers that
  rune's combat modifier onto it, so a longer (rarer, better-reward) recipe is also a
  harder fight.
- Recipes are largely known in advance (not blind RNG) — `(list of Runeshapes) → item`
  is public data. **poe2db.tw/Runeshape_Combinations** is the canonical source; example
  recipes found during research: `Adaptive + Protective → Exalted Orb` (2 runes),
  `Tidal + Prismatic + Toxic + Vision + Celestial + Soul + Death + Power + Life →
  Divine Orb` (9 runes). Because the mapping is known, players target a specific
  reward rather than hoping for one.
- This is what the existing "Expedition Price Check" widget in this fork already
  reads: the **Runeshape Combinations panel**, which on selecting/previewing a
  Remnant lists several reward options simultaneously (not just one) for the player to
  pick from.

## 3. The reward panel: multiple options, each with attached runes

Each row in the Runeshape Combinations panel pairs one reward (the currency/item the
recipe produces) with the strip of Runeshape icons that recipe consumes. This is the
part of the mechanic this project's widget currently prices (the reward) but does not
yet interpret (the icon strip). A few concrete, in-repo-verified facts about the icon
strip's layout:

- Each row shows up to **5 rune icons** in a strip, immediately left of the reward
  text.
- Layout is not fixed-width: with few icons/a short name, the icon strip and reward
  text share one line; with many icons or a long name, the bar grows taller and the
  icons occupy the full row width with text dropping to its own line below. (Verified
  independently by two different OCR-based tools working against this same panel —
  see §7.)

## 4. Succession / "gilded" runes — the carry-forward mechanic

*(Primary sources: [timesaver.gg — Oath Rune guide](https://timesaver.gg/blog/poe2-oath-rune-guide),
[expcarry.com guide](https://expcarry.com/poe-2-runes-of-aldur-guide); both
independently use the term "propagate" for this, and agree on the mechanics below.)*

This is the min-max layer the user is scoping tooling for.

- **Rune slots are marked distinctly** — sources describe this as a gold icon /
  gold/gilded frame around an icon in the strip. A marked rune's modifier **carries
  forward ("propagates") to every subsequent Remnant/monster encounter in the same
  Expedition chain**, stacking with whatever the next Remnant's own gilded runes add.
- **Corrected 2026-09-14 (direct observation, supersedes the sources above):** a row
  can carry **more than one gilded rune**. The write-ups cited here all describe it as
  exactly one slot per Remnant, and this document previously repeated that; observing
  real reward panels shows otherwise. Treat "one gilded rune per row" as **false** —
  any tooling must handle a set, not a single slot. (The display layer originally
  stored one and silently dropped the rest; see `EXPEDITION_RUNE_PORT_PLAN.md`.)
- Consequence: **picking a reward row is a two-part decision**, not one —
  1. the immediate reward the row grants, and
  2. the modifier that row's gilded rune seeds onto **every remaining encounter in the
     chain**, which is often the higher-value half of the decision, especially early
     in a chain where the propagated effect has the most remaining encounters to act
     on.
- **Only *new*, *distinct* gilded runes add value.** Re-selecting a row whose gilded
  rune is one you've already propagated this chain is a wasted slot — sometimes
  called "double dipping" — because the modifier was already active; you gained
  nothing but spent the pick. This is exactly the "already selected, don't double
  dip" tracking the user described wanting from the tool.
- **Which cell is gilded is randomised per Remnant** — it is not a fixed property of
  a given reward/recipe, so a static "this reward's gilded rune is always X" table
  cannot exist; it has to be read off each panel as it appears. (This is precisely why
  a third-party tool's in-development approach — see the companion
  document at that project's root — reads gilded state from the live panel rather
  than hard-coding it, and only uses static game data for the *name* resolution, not
  the *gilding*.)
- **Placement/sequencing matters.** Because a propagated effect only affects
  encounters *after* the Remnant that seeded it, the position of a Remnant within a
  planned chain is a real lever: a modifier your build can't handle is best pushed
  late (or the Remnant skipped) since it then affects fewer subsequent fights, while a
  modifier that increases rewards (rarity/quantity/currency) is best seeded as early
  as possible in the chain so it benefits the most remaining encounters.
- **Community-documented bad pick:** the **Oath Rune** ("may spawn a monster that
  summons allies") is called out specifically as a trap gilded pick — propagating it
  seeds an effectively-immortal, loot-less add-summoner into every subsequent
  encounter in the chain, not just one fight. Per the timesaver.gg guide, GGG has
  signalled a nerf to this is coming; treat "Oath is bad" as current-patch community
  consensus rather than a permanent design fact.
- Strategic framing from expcarry.com's guide, paraphrased: **prioritise gilded runes
  that pay back the propagation slot** — rarity, quantity, extra currency/artifact
  drops — **over ones that only add filler difficulty** (unkillable adds, pure
  time-sinks) with no compensating reward upside.

## 5. Rune tiers: blue / purple / gold, and known effects

*(Cross-checked two ways: general community description of a blue/purple/gold
color-coding — e.g. the user's own description and multiple guides — corroborated
against a **third-party open-source tool's shipped game-data file**, which lists all 34 Ezomyte Runeshapes
with their actual in-game tooltip effect text, `rare` flag, and confirmed tier for the
subset the tool's author has verified in-game. That file is static reference data — a
plain list of a public video game's rune names/effects/colors, the kind of thing any
price-checking or wiki tool needs — not executable code; reading it for its game-data
content carries none of the execution risk flagged in the companion document about
that project. Still worth a spot-check against poe2db.tw if this list is depended on
for anything load-bearing, since it's one project's own data file, not an official
GGG export.)*

**Read §5.1 alongside this.** The table below is sound, but *where the tier shows
up on screen* is not where this project assumed: it is the colour of the glyph
itself, not a coloured border. §5.1 has the measurement and extends the table.

Higher tier ≈ generally more powerful/desirable effect, and — per the user's own
description of the panel — gold is the top tier, purple the middle, blue the weakest,
with meaningful variation *within* a tier too (specific shapes carry different
practical weight even at the same color).

Confirmed-tier runes from that data file (tier is only populated for shapes the tool's
author has actually confirmed; most of the 34 are unconfirmed/likely-common and
omitted here):

| Tier | Rune | Effect (in-game) |
|---|---|---|
| Gold | Opulent | Increased Monster Rarity |
| Purple | Bond | Rare Monsters may transfer a Mod on death |
| Purple | Oath | May spawn a Monster that summons Allies *(community-flagged bad pick, §4)* |
| Purple | Time | Slain Monsters may respawn as a higher Rarity |
| Blue | Rage | Periodically Enrage |
| Blue | Sky | Conjures Elemental Tornados |
| Blue | Stone | Armoured; increased Stun Threshold; Earthly Prison |
| Blue | Vision | Reflect Curses; chance to Reflect Shock; chance to Reflect Chill |
| Blue | Volcanic | Extra Fire Damage; all Damage can Ignite; Ignited Ground Trails |
| Blue | Ward | Protected by Runic Ward |
| *(untiered, notably strong)* | Power | Empowered |

`Opulent` (flat monster-rarity-on-death-chain, gold tier) is the clearest example of
exactly the kind of "grab this over a better immediate currency option" pick the user
described wanting the tool to surface — it doesn't pay off on the Remnant it's picked
from, only on everything after it in the chain.

Other named Runeshapes seen in recipes/panels during research, effect/tier not yet
confirmed by the source above: Adaptive, Arcane, Bait, Bloodletting, Celestial, Cold,
Cyclonic, Death, Earth, Electrocuting, Fire, Life, Lightning, Momentum, Moon,
Prismatic, Protective, Rebirth, Soul, Tempest, Tidal, Toxic, Wisdom. (Sky was in this
unconfirmed list too until 2026-09-13, when it was cross-checked directly against real
screenshots — see `ocr-playground/fixtures/PANEL_GEOMETRY_NOTES.md` — and moved into
the confirmed table above as blue-tier, the first tier entry confirmed this way rather
than from a secondhand guide.) Bait is
notable as the one Runeshape that reportedly never appears in a normal Combinations
row per that same source's own dev notes — worth confirming before building anything
that assumes all 34 are selectable.)

### 5.1 Where the tier actually appears on screen — measured, 2026-09-17

*(Source: this repo's own fixtures. 11 real captures, 78 gradeable cells, measured
with a raw HSV dump rather than read off a guide. This supersedes the assumption
that the tier is a coloured **border**, which is what the detector and the fixture
schema were both built around.)*

**A rune cell carries three independent visual channels, not one.** Reading them
as one collapses them, which is exactly what went wrong.

| Channel | What it looks like | Varies with |
| --- | --- | --- |
| **Glyph ink** | The rune sigil itself, drawn in dark brown, purple, or gold | **The rune shape. Fixed.** |
| **Plate frame** | The thin square around the plate: plain dark brown, or blue with corner rivets | The panel. **Not** the rune. |
| **Succession cage** | A bright gilded frame with crown tabs, drawn *outside* the plate frame | The slot, per Remnant (§4) |

**The tier is the glyph ink.** Over all 11 captures, every rune identity has
exactly one ink colour — 23 identities, 78 observations, **zero conflicts** —
including seven identities that appear in two or three unrelated captures
(`life` in three, `oath` in two, `power`, `soul`, `vision`, `celestial`,
`adaptive`). And it agrees with §5's table, which was compiled independently from
in-game tooltips, on **all eight of its entries that these captures contain**
(`Time` and `Sky` appear in no fixture; `Power` it lists as untiered), under this
mapping:

| §5 says | Ink measured | Runes |
| --- | --- | --- |
| Gold | gold ink | Opulent |
| Purple | purple ink | Oath, Bond |
| Blue | plain dark ink | Rage, Stone, Vision, Volcanic, Ward |

So **blue is the baseline tier and gets no special colouring at all** — a blue
rune is simply an uncoloured one. There is no blue ink: every "black" glyph
measures at hue 11–15, one single population, with no dark-blue subgroup hiding
in it. Runes not yet in §5's table that measure as purple ink, and are therefore
purple-tier: **Death, Life, Power, Soul.** (Power was listed in §5 as
"untiered, notably strong" — it is purple.)

**The plate frame is not a tier.** `oath` is blue-framed in `Basic_test_1` and
plain-framed in both `full_live_images` and `opulent_rune_example` — same rune,
same glyph, different frame — so the frame cannot be a property of the rune. In
each capture **exactly one** rune identity carries the blue frame, and it appears
in every row of that panel. What it means is **not established**: candidates are
the runeshape you have selected or already placed, or a highlight-all-matching
hover. Distinguishing them needs one deliberate in-game observation, not more
pixels. It is independent of both other channels — `power` is blue-framed *and*
purple-inked, `stone` is blue-framed with plain ink, and `oath` in
`Basic_test_1` is blue-framed, purple-inked **and** caged, all three at once.

**Opulent has no gold frame.** This one mattered, because "opulent runes are
gold-tiered AND caged" was the stated justification for a detector fallback that
read a cage's gold as the rune's own tier. An HSV column scan across a caged
opulent cell reads, outside-in: cage gold (H 20–24, S 110–120, V 170–200), then a
dark brown frame (H 11–15, S 94–107, V 136–139), then parchment. That brown frame
is the same population as a caged `protective` cell's (H 10–11, S 123–144,
V 117–120) and a plain `bloodletting` cell's (H 11, S 122, V 117). Opulent's gold
is its cage and its *glyph*; its frame is the ordinary brown one.

**Consequence for tooling.** The tier is a static property of the rune shape, and
identity is already resolved in the renderer from the reward text
(`EXPEDITION_RUNE_PORT_PLAN.md`). So the tier does not need to be read from pixels
**at all** — it can come from a 34-row lookup table keyed by rune id. The only
genuinely per-instance thing in a cell is the **cage**, which is randomised per
Remnant (§4) and must be read from the panel. `ROADMAP.md` item 8 has that entry.

## 6. The outer loop: Logbooks, Uncharted Waters, Island Rumours and Sagas

Everything above describes what happens *on* an Expedition island. This section is the
layer above it — how you choose which island to go to. It matters for tooling because
it is a second place the game presents a choice with no help deciding, and because one
of its items already flows through the widget that exists today.

**Sourcing caveat, stronger than elsewhere in this doc:** this section is compiled from
community guides plus a third-party tool's shipped tier data, and **has not been
confirmed in game by anyone working on this fork.** Specifics — especially where in the
UI each thing appears — should be verified before any code depends on them.

- **Logbooks** are the consumable that reveals a new stretch of **Uncharted Waters** on
  the world map, unlocking further islands to run.
- Each logbook carries up to **three Island Rumours**: short flavour-text lines such as
  "Fallen Stars", "Cold as ice", or "Wild, Roaming Free". Each line corresponds to a
  specific destination island with a specific modifier or reward set — "Fallen Stars"
  leads to a Moor with Runestones, "Wild, Roaming Free" to a Grazed Prairie with Azmeri
  Spirits.
- **The game does not say which is which.** The rumour text is pure flavour; nothing on
  the panel indicates that one line is among the best outcomes available and another is
  near-worthless. This is the same shape of problem as §3's reward rows.
- **Sagas appear to be a separate mechanism, not the thing that shows rumours.** A Saga
  is used on an unexplored area of the waters and forces a specific boss encounter —
  Olroth's Saga guarantees Olroth, and so on. **Aldur's Saga is the exception**: rather
  than spawning a boss it grants a set of unusually strong map affixes to the zone it
  unlocks. The reported optimal play is to use a Saga on waters that already carry three
  good rumours, stacking both.
- **Sagas are themselves Expedition rewards**, which is the direct connection to the
  existing widget: this project's own captures include a single reward panel offering
  Aldur's, Olroth's, Vorana's, Uhtred's and Medved's Sagas as rows, meaning the price
  check already OCRs these names today.

### The rumour catalog is incomplete, and known to be

A hand-compiled tier list of **19 rumours** (`S+` down to `D`, each with its destination
island and modifier set) is staged in the sibling playground project at
`ocr-playground/rumours/`; its `SOURCE.md` has the provenance. Cross-checking it against
poe2db on 2026-09-17 found **agreement on every island the two sources share** —
Castaway → Gold, Untainted Paradise → Experience, Moment of Zen → travelling merchant,
and Obscure Island / Secluded Temple / Mournful Cliffside / Sprawling Jungle → Olroth /
Uhtred / Vorana / Medved.

It is nonetheless **not complete**: poe2db lists *The Fractured Lake* (mirrored rare
monsters, Fragmented Mirror) and *The Jade Isles* (three Manoki bosses), neither of
which appears in the staged 19, and the staged file itself estimates 30+ exist.

### One detail that matters disproportionately for OCR

**Rumour lines render in the game's handwritten italic parchment font**, not the block
text the reward rows use. The staged tier data carries an `aliases[]` field precisely
because that font produces mangled readings — "Nothin' to drink" for "Nothing to drink",
"Somethin' fishy" for "Something Fishy". Whether Windows OCR can read this font at all
is untested and is the single question that decides what a rumour feature costs to
build; see `ROADMAP.md` §5.

## 7. What this means for tooling (why this doc exists)

The existing widget in this fork prices reward rows; it does not yet read or score the
gilded-rune layer. A future feature here would need, at minimum:

1. **Read which cell(s) in each row's icon strip are gilded** (border colour/frame
   detection), separate from the reward-text OCR the widget already does.
2. **Identify *which* rune is in a gilded cell** — either by shape/color fingerprint
   (no game-data dependency, but needs a one-time "teach it" step per shape) or, if
   row names can be OCR'd reliably and cross-referenced against the public
   `poe2db.tw/Runeshape_Combinations` recipe table, by resolving row-name +
   cell-position straight to a known rune name with no manual labelling at all.
3. **Track a per-run "already carried" set** so a row whose only gilded rune is
   already-propagated can be flagged as a wasted pick (the "don't double dip" ask).
4. **Weight/score gilded runes**, not just reward currency value, so the UI can
   surface "worse currency now, but the better long-run pick" the way the user
   described — i.e. a combined score, not two separate numbers competing for
   attention.
5. Runs/chains have no explicit start/end signal from any known game API or log —
   detecting "a new Expedition chain started" (to know when to clear the carried set)
   is an open problem, not something solved by any source found during this research.

Item 2's two approaches (fingerprint-and-teach vs. resolve-from-public-recipe-table)
and the OCR layout quirks in §3 are exactly the design space the companion project
covered in this repo's sibling folder has been actively working through — see that
project's own findings document for the concrete approach it landed on, which is
directly relevant prior art for building the equivalent feature here.

## Sources

- [Mobalytics — Runes of Aldur League Mechanic Overview](https://mobalytics.gg/poe-2/guides/runes-of-aldur)
- [expcarry.com — PoE 2 Runes of Aldur League Mechanic Guide](https://expcarry.com/poe-2-runes-of-aldur-guide)
- [timesaver.gg — PoE2 Oath Rune Explained](https://timesaver.gg/blog/poe2-oath-rune-guide)
- [aoeah.com — PoE 2 0.5 Rune Remnant Recipes & Runic Remnants Farm](https://www.aoeah.com/news/4606--poe-2-05-rune-remnant-recipes--runic-remnants-farm)
- [Game8 — List of All Runeshape Combinations](https://game8.co/games/Path-of-Exile-2/archives/603197)
- [Fextralife — Runes of Aldur League Guide](https://pathofexile2.wiki.fextralife.com/Runes+of+Aldur)
- [Fextralife — Runes (equipment-socket system)](https://pathofexile2.wiki.fextralife.com/Runes)
- [Official 0.5.0 "Return of the Ancients" patch notes thread](https://www.pathofexile.com/forum/view-thread/3932540)
- [Maxroll — 0.5.0 Patch Notes summary](https://maxroll.gg/poe2/news/0-5-0-patch-notes-return-of-the-ancients)
- A third-party tool's shipped game-data file (read-only reference — see caveat in §5)

§6 (Logbooks / Uncharted Waters / Island Rumours / Sagas) additionally:

- [poe2db — Island Rumours](https://poe2db.tw/us/Island_Rumours)
- [Sportskeeda — All Island Rumors (Expedition mapping guide)](https://www.sportskeeda.com/mmo/all-island-rumors-path-exile-2-expedition-mapping-guide)
- [aoeah.com — PoE 2 Best Island Rumors Tier List, How to Get & Use](https://www.aoeah.com/news/4666--poe-2-best-island-rumors-tier-list-how-to-get--use)
- [Mobalytics — Grand Expeditions and Logbooks](https://mobalytics.gg/poe-2/profile/lolcohol/guides/grand-expeditions-and-logbooks)
- `ocr-playground/rumours/data.json` + `SOURCE.md` (hand-compiled tier list, 19 entries)
