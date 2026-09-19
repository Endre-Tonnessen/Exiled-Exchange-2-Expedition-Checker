# Expedition strategies — working notes

How to *play* the mechanic profitably. Its sibling
[EXPEDITION_LEAGUE_MECHANIC.md](./EXPEDITION_LEAGUE_MECHANIC.md) covers how the mechanic
*works*; [EXPEDITION_CHECK.md](./EXPEDITION_CHECK.md) covers the widget that reads the panel.

This is game-knowledge, not code documentation, and nothing here constrains the
implementation — but the two rules at the bottom are candidates for tooling.

**Sources:** CraftyXII's testing (video *"How Expeditions Really Work"*, 2026-07-28;
[spreadsheet](https://docs.google.com/spreadsheets/d/1QiDl0LyFoIjUG3wxS4kZVE3ELSVaXOvcCEc8aQyZlsQ/edit),
23 tabs, ~147 logged maps, ~3.7k div spent) and the r/PathOfExile2 thread of 2026-07-25.
All statistics below were **recomputed from the workbook's raw rows**, not taken from its
summary cells — several of those don't reconcile (see *Data quality* at the end).

**Patch context: everything in the source material predates 0.5.5 (released 2026-09-04).**
0.5.5 moved Runes of Aldur into the core game and added a dedicated Expedition Tablet with
explicit density modifiers. That directly contradicts the source's headline conclusion about
tablets. Sections are tagged accordingly.

### Which strategy applies to you

**Aldur's Saga is not removed from the game — it is league-locked.** It still drops in the
Runes of Aldur league, which continues to run alongside Forbidden Rites. It **cannot be
obtained in Standard or Forbidden Rites**.

| If you are playing | Use | Aldur's Saga |
| --- | --- | --- |
| **Forbidden Rites** (current event, 2026-09-04 → 2026-12-11) | **Strategy B** | Unobtainable |
| **Standard** | **Strategy B** | Unobtainable |
| **Runes of Aldur** (still running) | Strategy A | Obtainable |

The saga's *node modifiers* (`All +5`, `Lucky`, …) still generate naturally on Grand
Expeditions opened with a Logbook in Standard and Forbidden Rites, so the single most important
finding in this document survives into every league. Only the saga item itself is gated.

PoE2 1.0 begins 2026-12-11, when Forbidden Rites ends. Expect all of this to need re-testing.

Confidence tags used throughout:

| Tag | Meaning |
| --- | --- |
| **[measured]** | Recomputed here with a test statistic. Trust it. |
| **[claimed]** | CraftyXII's conclusion, data-backed but not statistically tested. |
| **[anecdote]** | Thread commenters. Single-player experience, no sample size. |
| **[superseded]** | 0.5.5 changed the mechanic. Needs re-testing. |

---

## The one thing that matters most

**[measured]** Aldur's Saga node modifiers dominate every other variable in the dataset.
Pooled across the two largest loot tabs:

| Node mod | Meaning | n | Div/map | Chaos/map |
| --- | --- | --- | --- | --- |
| `All +7` | every remnant has ≥7 runes | 3 | 18.0 | 30.7 |
| `All +6` | every remnant has ≥6 runes | 10 | 10.4 | 24.2 |
| `All +5` | every remnant has ≥5 runes | 34 | 7.6 | 15.0 |
| `Lucky` | each remnant rolled twice, best kept | 15 | 6.2 | 13.2 |
| `1x +7` | at least one 7-rune remnant | 22 | 5.6 | 10.1 |

- `All +6/+7` vs `All +5`: **t = 3.01** on chaos — solid.
- `All +5` vs `1x +7`: **t = 2.32** on chaos — real.

**`1x +7` is the worst bucket, not the best.** A guaranteed single 7-rune remnant is worse
than a floor of 5 everywhere. The big number is a trap.

This effect is larger than every tablet comparison in the workbook. Node selection beats
tablet selection.

**Post-0.5.5 note:** Aldur's Saga itself is league-restricted now, but *these modifiers still
appear naturally on Grand Expeditions opened with a Logbook* in Standard and Forbidden Rites.
The ranking above should still apply. Re-verify the bucket ordering if you can.

---

## Strategy A — Aldur's Saga (Runes of Aldur league only)

> **Not available in Forbidden Rites or Standard.** If that's where you're playing, skip to
> Strategy B — but read this section anyway, because B inherits almost all of it.

The high-investment route the source material was built around.

### Node selection
1. **Only burn a saga on a node with 4+ Grand Expedition rumors.** **[claimed]** — "huge profit
   ~95% of the time" at 4+. This is the top profit lever after node mods.
2. Boss-rush across opened areas to find one. **[anecdote]** Several people report 15–20
   logbooks without seeing a 4-rumor node. Expect to hunt.
3. Prefer `All +5` or better. Deprioritize `1x +N`.

### Map setup
4. **T16 waystone.** **[claimed]** Monster level is the biggest loot driver; T16 raises it.
   T16 was also used as the control because its affixes are easier to reproduce exactly.
5. **Stack waystone %, but stop around 100–120%.** **[measured]** Remnants with 6+ runes:

   | Waystone % | Share of remnants at 6+ runes |
   | --- | --- |
   | 0% | 16.8% |
   | 85% | 23.8% |
   | 120% | 24.4% |
   | 155% | 19.0% |

   0% vs 120% is χ² = 23.6, df = 6, **p = 0.0006**. But 155% tested *no better* than 120% and
   was statistically indistinguishable from 0% (p = 0.45). This is a threshold you clear, not
   a dial you maximise. Don't overpay past ~120%.

6. **Tablets: [superseded] — see the 0.5.5 section below.** The pre-patch advice was "any
   irradiated tablet, buy the cheapest, `+2 random map mods` preferred, blue performs the same
   as a 50div rare." White tablets *did* test meaningfully worse (~13 currency/map vs ~23–27),
   so the floor still holds: don't run white.

### In the expedition
7. **Never take Wisdom if Opulent is anywhere in your chain.** **[claimed, order-dependent]**
   Wisdom overwrites Opulent. Whichever is locked **first** wins — Opulent locked first
   survives; Wisdom locked first kills a later Opulent. Verified repeatedly on stream.
   Exceptions: no Opulent in the chain at all, or the Wisdom remnant holds an Aldur's Saga.
   ⚠️ A hotfix landed during the thread's lifetime. Verify in game.
8. **Rune priority:** Opulent, Bond, Death, Time, Power. **[anecdote]** Multiple people call
   Bond the best; CraftyXII didn't push back.
9. **Oath:** genuinely strong — adds several monster waves, effectively a large pack-size buff.
   **[anecdote]** One commenter's divine rate jumped when they resumed taking it. But it causes
   the unkillable-monster bug on most builds. Take it only if you overkill hard enough not to
   notice. Workaround: carry a Deadbell + warcry.
10. **Reroll rule:** reroll a remnant unless it has a rune you want for your chain, it's 7+
    sockets, or it holds raw Divine.
11. **Chain length is where jackpots live.** **[anecdote]** All the HH/Mageblood reports come
    from long chains ending in 7+ rune remnants with unique-belt recipes.

### Expectations
- ~4 maps per saga, often 5–6. You will eventually have to buy them.
- **[measured]** Aldur's Legacy: 1 in 147 logged maps (~0.5–1%).

---

## Strategy B — Logbook Grand Expeditions (Forbidden Rites / Standard) ← **default**

**This is the route if you're on Forbidden Rites or Standard.** Aldur's Saga can't be obtained
there, but the saga-style node modifiers still generate naturally on Grand Expeditions opened
with a Logbook — so the node-mod table at the top of this document still governs your loot.

Logbook acquisition and quality replace saga placement as the thing you optimise. You no longer
choose which node to burn a saga on; you choose which logbook to run and how to sustain them.

Everything in Strategy A applies **except** the saga steps:

- Node mod ranking (the table at the top) — should still hold, worth re-verifying.
- Waystone % threshold, T16, rune priority, Wisdom/Opulent rule, reroll rule — all unchanged
  by 0.5.5, which shipped **no balance changes** (those are held for 1.0).
- Logbook quality replaces saga placement as the node-selection lever.
- New in 0.5.5: a tablet modifier for *increased Quantity of Logbooks dropped by Runic
  Monsters*, which makes logbook sustain a tablet-influenced variable for the first time.

---

## Strategy C — Speedrun for boons, not currency

**[anecdote]** A different goal with a different optimum. One commenter got all boons in two
days: no sagas, no tablets, random T15, reroll everything, heavy movement speed, close ~99% of
expeditions without triggering any runestone, open the next map immediately. Maximise
expeditions-per-hour rather than value-per-expedition.

Use this when you want boons/uniques from the recipe pool. It is explicitly *not* the
currency-farming route.

Related **[anecdote, Runes of Aldur only]**: Fallen Stars + Visions of Paradise yields 2
Aldur's Sagas. Fallen Stars
has 8 runes and you only need 7 for the saga; Aldur's Saga excludes the Oath Rune where Perfect
Flux includes it, which makes Aldur's the safer pick unless you specifically need Perfect Flux.

---

## Strategy D — Core Expedition in maps (new in 0.5.5)

**[superseded / untested]** Entirely new surface. Nothing in the source material covers it.

What 0.5.5 added:
- Farrow, Dannig and Expedition exist as core mechanics including in Standard; Expeditions
  available from Act 4 onward.
- **Expedition Tablets** in Standard and Forbidden Rites. Multiple tablets stack to alter
  Expedition content on maps, and can spawn **two Expeditions in one area**.
- **Using 4 tablets adds an additional Verisium Remnant and +35% increased Kalguuran Expedition
  density.**
- New tablet modifiers: increased Expedition Explosive AoE; increased Quantity of Logbooks from
  Runic Monsters; Expeditions contain Additional Bosses encased in ice; Expeditions contain
  Additional Verisium Sentries.

This is the part of the old advice that is most clearly dead — see below.

---

## Tablet buying guide (post-0.5.5)

Derived from the poe2db Expedition Tablet modifier pool, filtered through the measured
findings above. **[inferred]** — this is reasoning applied to a mod list, not a tested result.

### Two structural facts

**1. Every Expedition-specific modifier is a suffix.** The prefix pool is entirely generic map
mods, and it is almost exactly the set measured as *not reaching remnant loot* — effectiveness,
rarity of items, monster rarity, rare monsters, pack size, magic monsters, gold, experience.

> **Buy magic (blue) tablets and judge them on the suffix alone. The prefix is dead weight for
> expedition farming.** This is the mechanical reason behind CraftyXII's observation that a blue
> performed the same as a 50div rare — he found the effect without knowing the cause.

**2. Run four tablets.** 0.5.5 gives a breakpoint at four: **+1 Verisium Remnant and +35%
increased Kalguuran Expedition density**, regardless of what is on them. Four cheap tablets beat
two expensive ones.

### Buy — adds remnants or runes

These map onto the only levers measured to matter: remnant count and rune count.

| Modifier | Why |
| --- | --- |
| `Verisium Remnants have +(25—35)% chance to add an additional Runic Modifier in Map` | Closest analogue to the node-mod effect that dominated everything (`All +6` vs `All +5`, t = 3.01). More runes per remnant is the strongest lever in the dataset. |
| `Expeditions have +(30—40)% Surpassing chance to contain an additional Verisium Remnant` | Remnant count multiplies everything else. "Surpassing" implies it can exceed 100% for multiples. |
| `Map has (1—2) additional random Modifiers` | The sleeper — see below. |

### Buy — count-based, should survive even if rarity doesn't

- `Expeditions have +(30—40)% Surpassing chance to Duplicate Runic Monsters in Map`
- `Map contains (15—25)% increased number of Runic Monster Markers` — the standing theory is
  that rarity reaches *markers* but not remnants; more markers scales count either way
- `(15—25)% increased Quantity of Expedition Logbooks dropped by Runic Monsters in Map` —
  **on Forbidden Rites / Standard this is arguably top priority**, because logbooks are the only
  route to Grand Expeditions once Aldur's Saga is unavailable. Sustain is the bottleneck.

### Situational

- `(5—10)% increased Expedition Explosive Area of Effect in Map` — underrated. More reach per
  explosive budget means longer chains, and every jackpot report came from long chains ending in
  7+ rune remnants.
- `(15—25)% increased Expedition Monster Rarity in Map` — the rarity half is probably inert, but
  note the hidden `expedition elite pack size +20%` rider. Pack size is a count, so that part
  may work.
- `Additional Verisium Sentries` / `buried Strongboxes` / `Vaal Relics` / `Bosses encased in ice`
  — extra content, untested, value scales with clear speed.
- `Monsters from Verisium Remnants drop (15—25)% increased Verisium` — reroll fuel, and the
  reroll rule is aggressive.
- `The first (1—2) unearthed Runic Monsters will be Rare Monsters in Map`

### Skip

Measured not to reach remnant loot: `Monsters have increased Effectiveness`, `increased Rarity
of Items found`, `Map has increased Monster Rarity`, `increased number of Rare Monsters`,
`Pack Size`, `Magic Monsters`, `Gold`, `Experience`.

Irrelevant unless you want the content for its own sake: shrines, strongboxes, essences, Azmeri
spirits, rogue exiles, summoning circles, rare chests.

### The sleeper — and a candidate answer to the open question

`Map has (1—2) additional random Modifiers` is the direct descendant of the `+2 random map mods`
tablets CraftyXII called BiS while saying *"I have no answer as to why."*

Candidate answer: additional map modifiers raise the map's effective quant/rarity — the same
quantity his sheet tracks as "waystone %". And waystone % is the one stat **[measured]** to
shift rune counts (6+ runes: 16.8% at 0% → 24.4% at 120%, χ² p = 0.0006). So `+2 mods` plausibly
works *through* waystone %, which is his own unresolved theory (b).

If that holds it also predicts a ceiling: 155% tested no better than 120%, so stacking
additional-modifier tablets past that point should stop paying. Testable, and worth testing.

> ⚠️ **Naming trap:** `(30—40)% increased Quantity of Waystones found in Map` is **not** the same
> thing. That is waystone *drops* — sustain. It does not touch rune counts.

### A note on rarity

The trailing weight columns in the poe2db listing (`111`, `131`, `212`) appear uniform across the
expedition suffixes, which would mean no specific one is meaningfully rarer to roll. That
reinforces buying cheap over chasing a named mod. The meaning of those columns was not verified.

---

## What 0.5.5 invalidated

### "Tablets do almost nothing" — no longer safe to assume

CraftyXII's headline was that tablets and their modifiers have near-zero effect on monster
spawns or currency inside Grand Expeditions. 0.5.5 shipped a **dedicated Expedition Tablet**
whose modifiers are stated in mechanical terms: an extra Verisium Remnant and +35% expedition
density at 4 tablets. That is a direct, quantified effect on the exact things he measured.

**Treat the "buy the cheapest irradiated tablet" advice as expired for the new tablet type.**
The finding may well still hold for *generic* map tablets — his result was that rarity,
effectiveness, rare monsters and monster rarity don't reach remnant loot — but the new
Expedition-specific mods were not in the game when he tested.

His own mechanical theory is worth carrying forward as the thing to test: **remnants may be
treated as chests/strongboxes**, which would explain why monster-loot modifiers never reached
them. A commenter corroborated that remnant buffs propagate to strongbox monsters in normal
maps. If that's right, the new density/remnant-count mods should work precisely *because* they
change counts rather than monster loot rolls.

### Other items to re-check
- "Non-irradiated tablets just don't consume the map" — changed by core integration.
- Aldur's Saga availability — league-only now.
- The Oath rune unkillable-monster bug and the Wisdom/Opulent overwrite were both live bugs in
  July. Neither is a balance change, so either could have been hotfixed since. Verify both.

---

## What is *not* affected by the patch

**[measured]** These are properties of remnant/rune generation, and 0.5.5 shipped no balance
changes:

- **Innate map mods have no effect on rune counts.** 0 vs 1-and-3 innate mods, same area level
  and 0% waystone: χ² = 5.97, df = 6, **p = 0.43**.
- **Area level doesn't change remnant count.** Pooled alvl 81 = 10.98 remnants/map (93 maps)
  vs alvl 82 = 11.29 (42 maps); per-map sd is 3.26, so SE on a 20-map set is ±0.73. The gap is
  a fifth of one SE. Rune distribution across levels also tests flat (p = 0.66).
  Don't chase 82 over 81.
- **Waystone % doesn't change remnant *count*, only rune counts.** The workbook demonstrates
  this accidentally: the 0% control and the 120%+tablet set both recorded exactly **198
  remnants**. Their stated averages differ (10.42 vs 9.90) only because one was divided by 19
  maps and the other by 20.
- **Map base barely matters.** **[claimed]** Min-maxing specific maps is "a ton of time for not
  a lot of extra profit." Bleached Shoals is widely disliked for layout, not loot.

---

## Data quality — read before trusting the spreadsheet directly

The workbook's raw rows are sound; several of its summary cells are not.

1. **`Blue Just Effectiveness` tab is empty** (header row only). The isolated control for the
   single most-discussed variable was never filled in.
2. **Waystone Calculator's high-socket rows don't reconcile.** Sockets 3/4/5 match the raw
   tallies; 7, 8 and 9 don't. The pattern fits pooled numerators (28, 28) divided by one set's
   20 maps, which would inflate the high-rune slope ~1.8×. Those are exactly the rows you'd use
   to target rare recipes. The calculator also draws a straight line through two points and
   extrapolates — and the 155% set is where that line fails.
3. `Sockets 9` base is entered as `1.0` — the raw count of 1, not the 0.05 average. It
   propagates into the "Total Sockets" output.
4. Socket-5 total recorded as `126` where its components sum to `170`.
5. Same set labelled `T16 85%` in Conclusions but sourced from a tab named `115%`. The
   `Waystone%` column is entered inconsistently as both `1.55` and `120`.
6. `Perfect Chaos = 8` in the Blue Just Rarity footer, against ~0.2 everywhere else —
   misaligned cell.
7. Control map count is 19 in Conclusions but 20 rows in the source tab.
8. **Loot tabs never record map tier or waystone %.** A prose comment claims "same 70%
   effectiveness tier 16" throughout, but it isn't in the data — so white-vs-blue comparisons
   may be partly tier comparisons.

One genuine validity check in there: the 115% tab notes map XP surpassing the control after 6
maps (1,610,587 → 1,698,989), confirming the tablet was actually applying.

---

## Open questions

CraftyXII flags this himself and never resolved it: either the `+2 random map mods` oversaturate
rarity/effectiveness so tablet-level changes can't register, **or** waystone % is doing all the
work. Until that's separated, "what's BiS on a tablet" has no answer.

Unrelated but unmeasured in the workbook: whether rarity affects *monster marker* loot while
leaving remnant loot alone. The columns never separate the two.

---

## Relevance to the Runeshape Combinations reader

Two rules here are fully mechanical and could be surfaced from panel state:

- **Wisdom/Opulent conflict** — warn when a Wisdom rune would be locked while an unlocked
  Opulent remains later in the chain.
- **Reroll heuristic** — reroll unless the remnant has a wanted chain rune, is 7+ sockets, or
  holds raw Divine.

Both depend on reading rune identity and socket count off the panel, which is what the OCR work
already targets.
