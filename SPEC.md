# Coast FIRE — Spec (v2: two-income household)

A small, public, static web app that answers: *"If we both stopped saving for retirement, would what
we have grow into enough by the time we retire? If not yet, when could we stop, and what would it
take?"* v2 adds two incomes, per-partner coast ages, an HSA, Barista FIRE, solvers for the earliest
coast age, and an early-retirement bridge (Rule 72(t) + Roth conversion ladder).

**Privacy rule (hard requirement):** the app contains no personal financial data of any real
person. Every default is a published US median/typical figure or a legal limit, cited in section 8.
Nothing the user types leaves the device. A test fails on any dollar amount not traceable to this file.

---

## 1. House style

- Plain static HTML + CSS + vanilla JS. No build step, frameworks, CDN, external fonts or analytics.
- Files: `index.html`, `style.css`, `calc.js` (pure math, UMD: `window.CoastFire` / `module.exports`),
  `ui.js` (pure: the summary line of each collapsed section and the saved open/closed state, tested in
  node), `app.js` (DOM, SVG charts, storage), `sw.js` (network-first, cached fallback after 3 s; cache
  `coast-fire-v6`), `manifest.webmanifest`, `icons/` (made by `tools/make_icons.py`), `privacy.html`,
  `tests/run_tests.js`, `README.md`, `SPEC.md`.
- Mobile-first at 375px: one column, max-width 420px, 16px gutters plus safe-area insets, no
  horizontal scroll. At 860px and up: inputs on the left (340–400px), results on the right.
- Light and dark from `prefers-color-scheme`; `:root[data-theme]` overrides exist for testing.
- `localStorage` key `coastfire.v2` (JSON of all inputs), every access in try/catch. Layout lives apart
  from the numbers: `coastfire.ui.v1` (`{sectionId: open}`) and `coastfire.chartHintSeen`; reset, Undo
  and shared links never touch them. A v1 value
  (`coastfire.inputs`) is migrated once (household fields only) and deleted.

## 2. Inputs (all money in today's dollars)

Every number has a box and a slider. Money sliders are square-root scaled. Typing past a slider's
range is allowed (the slider pins to its end); typing past a field's limit clamps, with a
right-aligned note ("Over the 2026 limit · using $24,500" for legal limits). A non-number keeps the
last good value and marks the field invalid. Retirement age ≤ current age marks it invalid.

| Group | id | Label | Default | Slider | Field limits |
|---|---|---|---|---|---|
| Household | `age` | Current age | 42 | 18–80 | 0–110, whole |
| | `retAge` | Retirement age | 65 | 30–85 | 0–120, whole |
| | `assets` | Invested now | 45,000 | 0–2M √ | 0–1e10 |
| | `spend` | Spending in retirement | 71,000/yr | 10K–250K √ | 0–1e8 |
| | `draw` | Draw while coasting (Barista FIRE) | 0/yr | 0–100K √ | 0–1e8 |
| Assumptions (collapsed; header shows "7.0% · 2.4% · 4.0%") | `nominal` | Return before inflation | 7.0% | 0–12 | −20–30 |
| | `inflation` | Inflation | 2.4% | 0–8 | −5–20 |
| | `swr` | Safe withdrawal rate | 4.0% | 2.5–6 | 0.1–20 |
| Earners | `two` | Two incomes (switch) | on | | |
| Partner A / B | `salA/B` | Annual salary | 62,608 | 0–300K √ | 0–1e8 |
| | `kA/B` | 401(k) you put in | 4,800/yr | 0–24,500 √, tick + "$24,500 limit" | 0–24,500 |
| | `empA/B` | Employer adds | 4.3% of pay | 0–10 | 0–50 |
| | `rothA/B` | Roth IRA | 3,200/yr | 0–7,500 √, tick + "$7,500 limit" | 0–7,500 |
| | `coastOnA/B` | Coast from an age (switch) | off | | |
| | `coastAgeA/B` | Coast from age (shown when on) | 55 | 18–85 | 0–120, whole |
| | `afterA/B` | Keep saving after coasting | 0% of before | 0–100 | 0–100 |
| HSA | `hsaFamily` | Family / Self-only (segmented) | Family | | |
| | `hsa` | HSA contributions (one household row) | 1,400/yr | 0–limit √ | family 8,750; self-only 4,400 per person |
| Bridge (shown when retAge < 59½) | `preShare` | Share that is pre-tax | 90% | 0–100 | |
| | `sepShare` | Pre-tax set aside for 72(t) | 50% | 0–100 | |
| | `sepRate` | 72(t) interest rate | 5.0% | 0–10 | 0–20 (above 5% the bridge warns) |
| | `basis` | Roth contributions (basis) | 0 | 0–500K √ | |
| | `taxable` | Taxable + cash | 0 | 0–500K √ | |
| | `lead` | Start conversions early | 0 yrs | 0–5 | whole |

Money slider ends (dollars): assets 2000000, spending 250000, salary 300000.

Catch-up contributions (401(k) age 50+ $8,000, ages 60–63 $11,250; IRA 50+ $1,100) and Roth IRA
income limits are mentioned in hints, not modeled. Switches are stored as 0/1.

Removing Partner B (the × on B's card or the Two incomes switch) is single-person mode: B's card,
B's solver row and B's bar disappear; self-only HSA limit becomes $4,400. One-person mode speaks to
"you": Partner A's card, bar and hints say "You"/"your", the solver row has no badge, and the HSA row
is "HSA" (two people: "HSA (shared)" for family coverage, "HSAs (A + B)" for self-only).

## 3. Outputs

**Answer card (hero).** Progress ring (invested ÷ today's coast number), then a status chip with an
icon and a word, then one big value with a caption, then one plain sentence (serif, 17px) that
describes the *same* scenario as the big value:

| State | Chip | Big value / caption | Sentence |
|---|---|---|---|
| Earliest both-coast age = today, nothing saved after coasting | good, boat "Coasting now" | "Now" / you could both stop saving today | "Your $X already grows into your $F FIRE number by R…, with no more saving." |
| Earliest both-coast age = today, but only with the after-coasting shares (`earliest.both.after` > 0) | good, check "Cut back now" | "Now" / you could both cut to your after-coasting shares today | "Keep adding $D/yr (your after-coasting shares) and growth takes you to your $F FIRE number by R." |
| Solved age c < R, plan reaches FIRE | good, check "On track" | c / earliest age you can both stop saving | "Keep adding $C/yr together until c. After that, growth alone takes you to your $F FIRE number by R." (with saving-after-coasting: "then $D/yr after that") |
| Solved age c < R, plan as entered short | warn "Plan $X short" | c | same + "Your plan as entered (A coasts at 55) ends $X short." |
| c = R | warn, clock "Not before R" | R / keep saving right up to retirement | |
| Not possible | bad, alert "$X short" ("$X short saving to R" when a coast age is on, since the tile and bottom bar show the plan as entered) | "Not by R" / saving the whole way isn't enough yet | "Not quite on course yet. At $23K/yr you reach $1.01M by 65, short of $1.78M." + one quiet line "To get there by R: save ~$K/yr, retire at R′, or spend ~$S/yr.", which opens the full list with today's values |

**Calm first screen (progressive disclosure).** Shown by default: masthead (logo, title, share and reset),
the answer card, and the chart card (title, one-line subtitle, a three-item legend with an "Other lines"
button for the keys of the other three (always drawn), readout, plot, and a hint "Drag the chart, or use
the arrow keys, to read any age." shown until the chart is first used; the chart's label always names the
keys); then
the four main inputs, the Two incomes switch, each partner's salary with one total line ("Saving $X/yr
· Y% of pay"), and Copy link / Reset. Everything else is a native `<details>` row whose closed summary
shows a live one-line value at a fixed height: the numbers (KPIs) right after the chart; Returns;
Barista draw; each partner's 401(k), employer, Roth and coast plan; HSA; Buying a home (off by default, section 11); and a "Go deeper" list:
contributions, earliest coast age (with the sparkline nested), what if returns differ (with "How to read
this" nested), the early-access bridge, and how it works (seven explainers in the same rows, all closed, "What is Coast FIRE?" first).
"What if returns differ" summarises the grid ("N of 25 make it", "all 25 make it", "none make it by R").
A partner's coast row reads "coasts at C, then $X/yr" when part of the saving continues.
Before 59½ the bridge's chip and a one-sentence teaser show above its closed row (no second chip inside
it), and the same chip with "before 59½: see the bridge" shows in the answer card; crossing 59½ never
opens it. Field hints show while the number box has focus or after a tap on the label's (i); hints
holding a button and the coast-age warning always show; slider range labels show only on focus (the
limit tick always). An error inside a closed section opens it. A button that changes a field in a
closed section opens it only if that section is the button's own or comes later on the page;
otherwise the row flashes. Charts in a closed section are drawn when it opens. At 860px and up the
numbers start open unless the reader has closed them. Only the reader's own opens and closes are saved;
the page's (saved state, errors, Apply buttons) are not.

KPI tiles (a plain two-column list with hairlines inside "The numbers"), each with a line of its own maths: **FIRE number** ("$71,000 ÷ 4.0%"),
**Coast number today** ("needed now to coast to 65 · you have $45K"), **At 65, your plan** (the only
balance-at-retirement figure; ▲ surplus / ▼ short with icon and word, plus the plan, e.g. "saving to
65" or "plan as entered: A coasts at 55"; the tile turns bad when short), **Meets the coast line** (first whole age the
plan as entered is at/above the coast line; labelled separately from the solved both-coast age).
A fifth, full-width tile, **Never coast: earliest retirement** (with the dashed teal line key), gives
the first whole age at which saving at full pace and never coasting reaches the FIRE number ("About 75"),
with the yearly saving rounded like the headline ("Saving about $23K/yr together, never coasting, you pass
$1.78M during age 74, so you could retire at about 75"; "you reach $X at N" when it lands on a year-end)
and, on its own line, how it compares to the chosen retirement age (▲ "N yrs before your chosen R" /
✓ "right at your chosen R" / ▼ "N yrs after your chosen R"). Already there: "Now". Never by the end of
the search (`top` = max(100, R, today's age)): "Not by {top}".

Sticky bottom bar on phones (hidden ≥860px and while the answer card is on screen): mini ring with
its percent + "Both coast at 62 · At 65 $X ▼ $Y short" (icon + word) + "Result ↑".

Masthead: 44px icon buttons for Copy link and Reset. Full buttons repeat after the inputs. Messages
(link copied, Undo after reset/apply/remove) appear in an ink toast.

## 4. Math (calc.js; all real, today's dollars)

### 4.1 Rates
`r = (1 + nominal) / (1 + inflation) − 1` (Fisher, exact). `FIRE = spend / max(swr, 0.1%)`.
`n = retAge − age` (≤ 0 → warning, no projection). `coastLine(k) = FIRE / (1 + r)^(n − k)`;
`coastNow = coastLine(0)`.

### 4.2 Contributions in the year starting at age a
For each partner p: `base_p = k_p + sal_p × emp_p + roth_p`; factor `f_p(a) = after_p` if p's coast
switch is on and `a ≥ coastAge_p`, else 1. Partner p adds `base_p × f_p(a)`.
HSA, family coverage: one account; full until every partner is coasting, then the `after` share of
whoever coasted last. On a tie (partners coasting at the same latest age) it is the larger of their
`after` shares, so partner order never matters (the household keeps funding the shared account at the
larger rate). Self-only: split evenly, each half follows its partner.
Total `C(a)` = sum of partners + HSA. Held constant in real terms.

### 4.3 Projection (yearly)
`B_0 = assets`; `B_{k+1} = max(0, B_k (1 + r) + C(age + k) − D(age + k))`, k = 0…n−1, where the
Barista draw `D(a) = draw` from the first partner's coast age to retirement, else 0.
Closed form for the tests (both coast at c, after = 0, no draw, k = c − age):
`B_n = (A (1+r)^k + C · ((1+r)^k − 1)/r) · (1+r)^(n−k)`.

### 4.4 Results
- `crossAge`: first whole age with `B_k ≥ coastLine(k)` for the plan as entered.
- `earliest.both`: smallest whole c in [age, retAge] such that both partners coasting at c (each
  keeping their own `after` share, draw from c) gives `B_n ≥ FIRE`. c = retAge means saving to the
  end. None → `{age: null, best}` with `best` = balance saving the whole way. A solved age also
  carries `after`, the yearly saving still going in once coasting starts (0 when nobody keeps saving);
  the page only says "no more saving" when it is 0.
- `earliest.A` / `earliest.B`: the same with only that partner's coast age moved, the other's plan
  held as entered. Shown with "N yrs coasting", or "Not possible" + reason.
  With after = 0 and no draw, `earliest.both == crossAge`; otherwise they can differ and both show.
- `requiredAnnual = (FIRE − A (1+r)^n) / ((1+r)^n − 1) × r` (r = 0: `(FIRE − A)/n`).
- `retireLater`: when `earliest.both` is null, the never-coast `wholeAge` (the same full-saving
  recurrence, so the nudge and the Never coast tile always agree); null when that is null too (the nudge
  then just says "retire later").
- `spendWithin = fullBalance × swr`.
- `neverCoast = neverCoastAge(v, fire, r, maxAge = 100)` → `{age, wholeAge, yearly, points}`: keep
  saving at full pace and never coast. Every partner keeps their full pre-coast saving (401(k),
  employer, Roth, HSA: `yearly = C` with nobody coasting, constant in today's dollars), coast ages and
  the Barista draw are ignored, and the household keeps working past `retAge` if needed:
  `B_0 = assets`, `B_{k+1} = max(0, B_k (1 + r) + C)` for every whole age up to
  `top = max(age, retAge, 100)` (returned as `top`). `wholeAge` = first
  whole age with `B ≥ FIRE`; `age` interpolates linearly between the two year-ends around the crossing,
  `age = a − 1 + (FIRE − B_{a−1}) / (B_a − B_{a−1})` (the current age when already there today). Never
  by `top` → both null ("Not by {top}"). Closed form for the tests:
  `B_k = A (1+r)^k + C ((1+r)^k − 1)/r`. When `earliest.both` is null, `retireLater == wholeAge` by
  construction (both null when FIRE isn't reached by `top`).
- `sweep`: balance at retirement for every common coast age (sparkline).
- `grid`: earliest both-coast age for nominal return input ±2 points (rows) × SWR 3.0/3.5/4.0/4.5/5.0
  (columns); unreachable cells report `best / FIRE`.

**Heatmap ("What if returns or withdrawals differ?") layout.** A real `<table>`:
- visible `<caption>` above the grid, one plain sentence on what a cell means: "Each number is the
  earliest age you could both stop saving and still reach your FIRE number by R ("Now" = today)."
  (all cells unreachable: "Each cell is the share of your FIRE number you'd have at R, saving the
  whole way.");
- header row 1: a column-axis title `<th scope="colgroup">` "Safe withdrawal rate →" spanning the
  columns, with a rule under it; the corner `<th scope="col" rowspan="2">` is the row-axis title
  "Investment return, before inflation ↓" (horizontal text in the corner, above the row headers, so it
  reads the same on a phone);
- header row 2: "3.0% SWR" … "5.0% SWR" (value + small unit line); row headers "9.0% return" … ;
  the header of the user's own row and column is in ink;
- the user's cell is outlined and labelled "your inputs" inside the cell (and in its aria-label); when
  the SWR is between columns, a note says no cell is marked and the middle row is the user's return;
- a legend below, in words: "Shade = years coasting before R" + the 5-step ramp with bins and
  "← stop later · stop sooner →" (direction, not lightness, since the ramp flips in dark mode); a hatched swatch "Hatched = can't reach your FIRE number
  by R, even saving the whole way. The % is how much of it you'd have."; an outlined swatch
  "Outlined = your inputs" (a surface-coloured swatch with the ink outline, so it matches coloured and
  hatched cells). The card subtitle is a short framing line ("Same plan, a different market or
  withdrawal rate."); the table caption carries what a cell means.

## 5. Early-access bridge (retAge < 59½)

- Portfolio at retirement `P` = the plan's projected balance. Pre-tax = `P × preShare`.
  **72(t) IRA** = pre-tax × `sepShare`; **ladder IRA** = the rest. Separate pots, so no dollar is
  counted twice ("Size 72(t) to cover spending" sets the share whose first payment = spending).
- 72(t) fixed amortization: `PMT = B · i / (1 − (1 + i)^−LE)` with `i = sepRate` (Notice 2022-6:
  up to the greater of 5% or 120% of the federal mid-term rate) and LE from the IRS Single Life
  Table at the retirement age (ages 30–60 in calc.js, verified below). The payment is fixed in
  nominal dollars, so in today's dollars year j is `PMT / (1 + inflation)^j`. A rate above 5% is
  flagged (`rateOverCap`): it is only allowed when 120% of the federal mid-term rate for either of the
  two months before the first payment is higher, otherwise the payments don't qualify. Locked for the longer
  of 5 years or until 59½ (`max(R + 5, 59.5)`; flagged when past 59½).
- Bridge years R, R+1, … while under 59½; the last year is ½ when needed. Need = spend × fraction.
- Ladder: one rung per year from `R − lead` while the rung ripens before 59½; rung for usable age a
  = `max(0, need_a − 72(t)_a) × (1 + inflation)^5` (converted principal is nominal), capped by the
  ladder pot (which grows at r after retirement; pre-retirement rungs cost what they'd have grown to).
- Each year: 72(t) first (any excess kept as cash), then taxable/cash, then Roth basis, then ripe
  ladder money; anything left is a gap year (red, hatched, with "⚠ −$X").
- Shown: chip (N short years / No gaps), 72(t) payment and lock KPIs, access timeline (72(t) locked to
  59½; ladder "convert · 5-yr wait" dashed, then "usable"), stacked year bars with a spending line, a
  gap list in words with remedies (convert earlier, more cash, larger 72(t) share), a collapsible
  table and a caveats section linking the IRS SEPP page and Kitces' Notice 2022-6 article.
- Warns when taxable + basis exceed the non-pre-tax part of the portfolio. Not modeled: taxes on
  payments and conversions, the 5-year rule's January 1 start, the aggregation rules.
- retAge ≥ 59½: a flat teaser card ("Retiring before 59½?") with "Try retiring at 55".
  retAge < 30: a note that the table covers starting ages 30–60.

## 6. Edge cases

| Case | Behavior |
|---|---|
| retAge ≤ age | Field invalid; chip "Check ages"; ring and all four KPI tiles "—" ("Fix the ages first", no good/bad tile colour); chart empty state titled "Your path"; one muted line instead of the solver rows and no sparkline; heatmap and its legend hidden. |
| r = 0 | Annuity factor = n; no division by zero. |
| Never coast doesn't reach FIRE by `top` (100, or R / today's age when later) | Tile "Not by {top}"; nudge "retire later" with no age; no crossing dot; the x-axis stays at R. |
| r < 0 | Allowed; warning "Your return is below inflation…". |
| spend = 0 | FIRE 0, coasting now. |
| Over legal limit | Clamped with the 2026-limit note. HSA re-clamped when coverage or partner count changes. |
| Coast age ≤ current age | Coasting from today (hint says so). Coast age ≥ retAge: no effect (hint). |
| Barista draw > growth | Balance floors at 0. |
| Huge numbers | Non-finite results → "Too large to show". |
| Shared link (`#a=..&r=..`) | Shown over the defaults with a banner; saved numbers untouched until edit or Keep. v1 links still open (unknown keys ignored). |

## 7. Design ("dashboard" layout, ivory/ink + cobalt)

Tokens on `:root`: bg #f6f3ec, surface #fffdf9, ink #1d1c1a, ink-2 #4f4b44, muted #6f6962, line
#e4ded3, accent (UI and projection line) #2f5bb8, text accent #24489a; dark: bg #141311, surface
#1c1b18, ink #efebe3, accent #5f88e0. Serif (system Iowan/Palatino/Georgia) for headings and the
headline; sans for numbers (the 44px hero number is sans). Only the answer and chart cards are raised; inputs and the Go deeper rows sit on the page background, separated by space and hairlines. Status good/bad/warn always with icon +
word. Series (validated with the dataviz validator, both modes): 401(k) #2f5bb8, employer #20917a,
Roth #c2602e, HSA #a0549a; bridge 72(t) blue, taxable neutral, Roth basis orange, ladder teal,
short = hatched red. Bridge colours follow meaning, not position: pre-tax money blue (401(k), 72(t)),
Roth money orange (Roth IRA, basis; ladder a darker/lighter orange step, `--ladder` #853e19 / dark
#e9a679), taxable neutral (`--tax` #8a8478, ≥3:1 on the surface). Heatmap: one blue hue, 5 steps by
years of coasting (0, 1–4, 5–9, 10–14, 15+), each swatch labelled with its bin; lightest step ≥2:1 on the
surface, adjacent steps ≥0.06 apart in OKLab L, cell text ≥4.5:1 (light #9db5e6 #809fdf #6388d6
#436cc8 #26499b; dark #384c76 #425c93 #4a6cb4 #6990e2 #9dbaf5). The number in a cell is the age, the
shade is years coasting. Unreachable cells are hatched neutral with a dashed outline and "% of FIRE
reached"; when every cell is unreachable the years ramp is hidden and a line says so.
Partner badges: A circle, B rounded square.

Charts (inline SVG, no libraries): main path (projection bends at each coast age, coast line in
ink labelled "coast line" at the left, stop-today dashed with an inline label that shortens or moves to
fit, FIRE reference line as a muted hairline labelled, coasting band (no wash under the projection),
A/B pins with alternating labels; all labels are placed together so none overlap, first x tick "age N", crossing dot, end value label, "Short $X" bracket at the right edge, a
readout bar above the plot that is aria-live, crosshair, ←/→/Home/End, "Show as a table");
plus the **keep saving, never coast** line (`--keep`, the validated teal series step #20917a / dark
#2aa384, dashed 7–3, in the legend as "Keep saving, never coast", with "(same as your plan to R)" when
nobody coasts). It is drawn from where it leaves the plan (at R when nobody coasts). When its FIRE age
is after R the x-axis runs to `min(top, wholeAge + 2)`, a dotted hairline and a bold tick mark R, the
never-coast age always gets a tick (other ticks within 22px of it are dropped), and only this line continues past R. A teal dot sits where it
meets the FIRE line, labelled "Keep saving → retire at N", placed clear of the projection and
never-coast lines when it can be; when already at FIRE today there is no dot or label (the tile says
"Now"). The projection's end label and the coast-pin labels also try spots clear of the never-coast line
first. At rest the readout is quiet (no box, plain weight: age, Projected, Coast line); while dragging or
stepping it shows the plan's gap right after Projected / Coast line ("plan $X below coast line"), then "Keep saving $X" where it differs from the plan, and past R shows "Keep saving $X · still
working past R · $Y over/under FIRE"; the table gains a "Never coast" column and rows to the end of the
axis, ✓ on the first age at the FIRE number. Its note sits above the scroll box; at ≤480px amounts are
compact and the Age column is sticky;
progress ring; per-partner stacked bars with a 0/$5K/$10K axis; earliest-coast rows with Apply
buttons (only next to a solved age) and a sparkline zoomed to the data (no "$0" baseline unless the
scale reaches 0; the title says where the scale starts; the "reaches FIRE" zone is a neutral wash); heatmap as a real `<table>` with focusable cells;
bridge timeline.

## 8. Default values and citations (verified 2026-10-16; the home's defaults are in 11.9)

| Input | Default | Source |
|---|---|---|
| Salary (each partner) | **62,608** | BLS: median usual weekly earnings of full-time workers, 2025 = $1,204 → × 52. https://www.bls.gov/opub/ted/2026/median-weekly-earnings-were-1204-in-2025.htm |
| 401(k) employee | **4,800/yr** (7.7%) | Vanguard *How America Saves 2025* (2024 data): "The average 401(k) deferral rate was 7.7% in 2024" (PLANADVISER, https://www.planadviser.com/automatic-plan-features-help-participant-savings-rates-stay-resilient-2024-says-vanguard/). 7.7% × $62,608 = $4,821, rounded. (The 2026 edition reports 7.6% for 2025.) |
| Employer | **4.3%** of pay | Same report: average total contribution rate (employee + employer) 12.0%, median 11.5% (24/7 Wall St. on Yahoo Finance, https://finance.yahoo.com/markets/options/articles/half-americans-falling-short-15-134844754.html) → 12.0 − 7.7 = 4.3. (2026 edition: 12.1% total, 4.7% average promised match.) |
| Roth IRA | **3,200/yr** | IRS SOI data in CRS R48051 (Dec 2025): tax year 2022 average Roth IRA contribution $3,482 overall, **$3,211 for ages 35 to under 50**. https://www.everycrsreport.com/reports/R48051.html |
| HSA (family, shared) | **1,400/yr** | Devenir 2025 Year-End HSA Research Report: "nearly $60 billion" contributed in 2025 across 41.7 million accounts ≈ $1,440 per account, rounded down. https://www.devenir.com/wp-content/uploads/2025-Year-End-Devenir-HSA-Research-Report-Executive-Summary.pdf |
| Invested now | **45,000** | Federal Reserve 2022 SCF: median retirement-account balance, families headed by someone 35–44 that have one = $45,000 (v1 citation; https://www.federalreserve.gov/publications/files/scf23.pdf, CRS IF12928). |
| Current age | **42** | BLS CPS Table 11b, 2025: median age of employed persons 42.1. https://www.bls.gov/cps/cpsaat11b.htm. Kept from v1; it sits in the SCF 35–44 band used for assets. |
| Spending | **71,000/yr** | BLS Consumer Expenditure Survey 2024, two-person consumer units: total average annual expenditures $80,830 (FRED CXUTOTALEXPLB0504M) minus personal insurance and pensions $9,652 (FRED CXUINSPENSNLB0504M; Social Security and retirement contributions that stop at retirement) = $71,178, rounded. |
| Inflation | **2.4%** | Social Security Trustees, intermediate long-range CPI assumption 2.40% (https://www.ssa.gov/OACT/TR/2023/V_B_econ.html; the 2026 memo on long-range assumptions lists only the real-wage assumption as changed). Replaces v1's 3.0% historical average with a forward-looking official assumption. |
| Return | **7.0%** | Common long-run planning figure; WalletBurst default. |
| Withdrawal | **4.0%** | Trinity study (1998) "4% rule". |
| Retirement age | **65** | Usual retirement / Medicare age. |
| Coast age (when switched on) | **55** | A placeholder midpoint; the switch is off by default. |
| Pre-tax share | **90%** | Roth IRAs hold 7.2% of US IRA + DC assets at year-end 2025 (2.4 of 33.4 trillion dollars; Q3 Advisors from the ICI 2026 Fact Book: https://q3adv.com/tax-free-retirement-gap-report/; a lower bound for all Roth, since Roth 401(k) money isn't counted). So about 93% is pre-tax; rounded down to 90% to leave room for HSA and taxable money. |
| 72(t) share, rate | **50%, 5%** | Even split; 5% = the Notice 2022-6 floor of the allowed maximum rate. |
| Basis, taxable, lead | **0** | Off until entered (a "Use estimate" link fills basis from the Roth inputs). |

**2026 limits (calc.js `LIMITS`):** 401(k) deferral $24,500, catch-up 50+ $8,000, ages 60–63
$11,250 (IRS newsroom, https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500);
IRA $7,500, catch-up $1,100 (same); HSA $4,400 self-only, $8,750 family (Rev. Proc. 2025-19).

**IRS Single Life Table (Treas. Reg. 1.401(a)(9)-9(b)), checked against the regulation text
(https://www.law.cornell.edu/cfr/text/26/1.401(a)(9)-9):** 30 55.3 · 31 54.4 · 32 53.4 · 33 52.5 ·
34 51.5 · 35 50.5 · 36 49.6 · 37 48.6 · 38 47.7 · 39 46.7 · 40 45.7 · 41 44.8 · 42 43.8 · 43 42.9 ·
44 41.9 · 45 41.0 · 46 40.0 · 47 39.0 · 48 38.1 · 49 37.1 · 50 36.2 · 51 35.3 · 52 34.3 · 53 33.4 ·
54 32.5 · 55 31.6 · 56 30.6 · 57 29.8 · 58 28.9 · 59 28.0 · 60 27.1. Notice 2022-6 requires this
table (or the Uniform Lifetime / Joint tables) for 72(t) from 2022: https://www.irs.gov/pub/irs-drop/n-22-06.pdf

With these defaults the household saves $22,784 a year and reaches about $1.01M ($1,009,932) by 65
against a FIRE number of $1.78M ($1,775,000): **not on course**. That's the first screen most people
see, so the shortfall state is designed as a first-class state (needs about $42K/yr ($42,452), or
retiring at 75, or spending about $40K/yr).

## 9. Tests (`node tests/run_tests.js`)

Hand-checked with a 0% real return (nominal = inflation) so every value adds up by hand:
- Two incomes: A 20,000/yr (10,000 + 5% of 100,000 + 5,000), B 6,000/yr, family HSA 2,000 →
  28,000/yr; 100,000 + 10 × 28,000 = 380,000 at 50; single-person 320,000.
- Coast downshift: A coasts at 45 keeping 50% → 330,000; both stop at 45 → 240,000; family HSA
  follows the last coaster; on a tie the larger share wins (both coast at 45, A keeps 20%, B 60%:
  1,200 of a 2,000 HSA, either partner order); self-only halves follow each partner.
- Barista draw: A coasts at 45, draw 4,000 → 100,000 + 140,000 + 5 × 4,000.
- Solver: FIRE 340,000 → both 49, A alone 48, B alone 44; holding B's coast at 45, A alone 50;
  FIRE 400,000 → not possible (best 380,000), needs 30,000/yr, retire at 51, spend 19,000.
  Solved "now" while still saving: 50% kept after coasting = 13,000 + 1,000 HSA = 14,000/yr; with
  200,000 invested the solver says 40 but the money alone stays under the coast number (`after` > 0).
- Never coast: 0% real, 100,000 + 28,000/yr against 400,000 → crosses at 50 + 20/28 = 50.71, first whole
  age 51 (= retire later at 51), same with coast ages and a draw switched on; closed form at 5% real
  from 0 saving 10,000/yr: FIRE = B_10 → exactly 50, FIRE at the continuous 10.5-year mark →
  interpolated between B_10 and B_11, first whole age 51; already past FIRE → today; FIRE 0 → today;
  nothing saved, or a negative real return that levels off below FIRE → null; search capped at 100;
  search runs to R when R > 100 and to today's age past 100; age 75 / R 85 / nothing invested →
  null and retireLater null (not 110); defaults → 75.
- 72(t) rate: above 5% is flagged (`rateOverCap`), 5% is not.
- 72(t): $1,000,000 at 45, 5%, LE 41.0 → $57,822.29; 0% rate → balance / LE; lock 52 → 59½, 57 → 62.
- Bridge: retire at 52 with 1,000,000 all pre-tax, half to 72(t) → 30,772.60/yr; spend 40,000,
  taxable 20,000, basis 10,000 → gaps at 55 and 56 totalling 16,137.02; ladder rungs at 52–54 ripen
  57–59 and cover them; converting 2 years early closes the gap; inflation shrinks 72(t) in real terms.
- With growth: loop = closed form (random sets), solver = brute force, solver = crossing when
  after = 0; required yearly total lands on FIRE; grid shape and % reached; limits and clamps; hash
  round trip incl. v1 links; slider scale; formatting (money as $1,234,567; 999,600 counts as $1M); the defaults table above; the Single Life
  values; the collapsed-row summaries and the saved open/closed map (`ui.js`); and the privacy scan (no spreadsheets; no dollar amount or 4+ digit number outside the
  allowlist of figures in this file), plus a check that every allowlist entry is written in this
  file or a test scenario.

## 10. Out of scope

Taxes (income tax on 72(t) and conversions, capital gains), Social Security, pensions, catch-up
contributions, Roth income limits, employer match formulas, Monte Carlo, post-retirement drawdown,
accounts or a server. For the home (section 11): a home already owned, refinancing, extra principal
payments, moving or buying twice, the mortgage interest deduction, capital-gains tax on the sale,
and taxes or penalties on taking the down payment out of retirement accounts.

## 11. Buying a home (rent vs buy)

An optional comparison: *"If we bought a home at age b instead of renting, when would we reach
FIRE, and what would we own at R?"* It is **off by default** and changes nothing on the page until
switched on. Renting is the plan as entered (the main projection, untouched); buying is the same plan
with the purchase and the month-to-month difference in housing cost flowing through savings. Not
advice; a model with stated assumptions.

### 11.1 Inputs (today's dollars; every number has a box and a slider like section 2)

| id | Label | Default | Slider | Field limits | Hash |
|---|---|---|---|---|---|
| `houseOn` | Compare buying a home (switch) | off (0) | | | `ho` |
| `buyAge` | Buy at age | 45 | 18–85 | 0–120, whole | `hb` |
| `price` | Home price (today's dollars, when you buy) | 418,000 | 50K–1.5M √ | 0–1e9, step 1,000 | `hp` |
| `downPct` | Down payment | 10% | 3–50 | **3**–100 (no 100% loan) | `hd` |
| `downFrom` | Down payment comes from (segmented) | Invested assets (1) | | 1 = invested assets, 0 = separate cash | `hf` |
| `mortRate` | Mortgage rate (before inflation) | 7.4% | 2–10 | 0–20, step 0.05 | `hm` |
| `term` | Term (segmented 15 / 30 years) | 30 | | anything but 15 cleans to 30 | `ht` |
| `pmi` | Mortgage insurance (PMI) (only when down < 20%; dimmed with "Not needed at 20% down" otherwise) | 0.6%/yr of the loan | 0–1.5 | 0–3 | `hq` |
| `closePct` | Closing costs when buying | 3% of price | 0–6 | 0–10 | `hc` |
| `sellPct` | Selling costs (net-worth comparison only) | 6% of value | 0–10 | 0–15 | `hs` |
| `propTax` | Property tax | 0.9%/yr of value | 0–3 | 0–5 | `hx` |
| `insure` | Home insurance | 1,600/yr | 0–10K √ | 0–1e6, step 50 | `hi` |
| `maint` | Maintenance | 1.0%/yr of value | 0–4 | 0–10 | `hn` |
| `apprec` | Home price growth above inflation | 0.5%/yr | −2–3 | −10–10 | `hg` |
| `rent` | Rent today | 1,530/mo | 0–5K √ | 0–1e6, step 10 | `hr` |
| `rentGrowth` | Rent growth above inflation | 0.0%/yr | −2–3 | −10–10 | `hw` |

All sixteen join `DEFAULTS`, `FIELDS`, `KEYS` and `HASH_KEYS` (the short names above collide with
none in use), so storage (`coastfire.v2`), shared links and Reset cover them; older links without them
open with the house off. Switches and segments are stored as numbers (0/1, 15/30). Hints:
- `buyAge`: "Already own your home? This section models a purchase, not a home you have." Buy age ≤
  current age → "Buying today." (the purchase happens at the current age).
- `price`: "What the home would cost if you bought it today; appreciation starts when you buy."
  The price is *at purchase*, so `apprec` only acts after the purchase and the breakeven in 11.4 is
  well defined.
- `rent`: "The rent for a home like the one you'd buy. Your retirement spending above already
  includes today's rent." (the explicit assumption, see 11.3).
- `downFrom` = invested assets, retAge or buyAge < 59½: "Taking it from a 401(k) or IRA before 59½
  usually costs tax and a 10% penalty (IRAs allow up to $10,000 once for a first home); not modeled."
- `pmi`: "Ends when the loan is scheduled to reach 78% of the price (you can ask at 80%)."

### 11.2 The model (calc.js `house(inputs, res)`; real, today's dollars, yearly like 4.3)

Notation: `π = inflation`, `r` = real return (4.1), `R = retAge`, `b = max(buyAge, age)`, `j = a − b`
(years since buying), `P = price`, `g = apprec`, `ρ = rentGrowth`.

At purchase:
- Down `D = P × downPct`, loan `L = P − D`, closing `K = P × closePct`, **cash at closing `D + K`**.
- Mortgage, fixed in dollars of the purchase year: monthly rate `m = mortRate / 12`, `N = 12 × term`,
  `PMT = L · m / (1 − (1 + m)^−N)`; `m = 0` → `PMT = L / N`; `L = 0` → 0.
- Scheduled balance after t payments (nominal) `S(t) = L(1+m)^t − PMT((1+m)^t − 1)/m`
  (`m = 0`: `L − PMT·t`), 0 once `t ≥ N`. In today's dollars at the end of year j: `S(12j) / (1+π)^j`.

Each year starting at age a ≥ b (j = a − b):
- Home value `V(a) = P (1 + g)^j`.
- Owning cost `Own(a)` = P&I `12·PMT / (1+π)^j` (j < term, else 0; a fixed payment shrinks in real
  terms) + tax `propTax · V(a)` + insurance `insure` (constant in today's dollars) + maintenance
  `maint · V(a)` + PMI `pmi · L / (1+π)^j × months/12` while `downPct < 20`, where `months` counts the
  months of year j whose scheduled balance at the start is above `0.78 P` (12 until the crossing year,
  pro-rated in it, 0 after; the automatic termination point under the Homeowners Protection Act,
  scheduled balance against the original value; earlier cancellation at 80% or on a new appraisal is
  not modeled).
- Rent instead `Rent(a) = 12 · rent · (1 + ρ)^(a − age)`.
- Difference `Δ(a) = Own(a) − Rent(a)` (positive = owning costs more).

The buying path (`buyPath`, same shape as `path` in 4.3, same plan, same coast ages and Barista draw):
`B_0 = assets`; in the year starting at age a, contributions `C′(a) = max(0, C(a) − Δ(a))` for
a ≥ b (else `C(a)`); `deficit(a) = max(0, Δ(a) − C(a))` is reported, not taken from the portfolio
(it is assumed to come out of pay; see the caveats). At a = b with `downFrom` = invested assets the
cash at closing leaves first: `B ← B − (D + K)`, then the year runs as usual:
`B_{k+1} = max(0, B_k (1 + r) + C′(age + k) − D_draw(age + k))`. When owning is cheaper (Δ < 0) the
saving adds to contributions, coasting or not. When `B < D + K` at b, `cashShort = D + K − B`; the path
floors at 0 and continues, and the page leads with the shortfall (11.5). The shortfall is not a gift:
buying net worth (and so both breakevens) subtracts it as a debt grown at r to R,
`cashShort (1 + r)^(R − b)`, and a line under the comparison says so. `downFrom` = separate cash:
the portfolio is untouched; for fairness the renter is credited the same cash invested at r from b
in net worth only (`(D + K)(1 + r)^(R − b)`), never in the FIRE portfolio.

Home equity at age a: `V(a) − S(12j)/(1+π)^j`; after selling costs: `V(a)(1 − sellPct) − balance`.
**Equity is never counted toward the FIRE portfolio** (you have to live somewhere); it appears only in
net worth.

### 11.3 Retirement spending and the two FIRE numbers

Assumption, stated in the section: *retirement spending (`spend`) includes today's rent.* So:
- **Renting:** `FIRE_rent = (spend + Rent(R) − 12·rent) / swr` (= the main FIRE number when ρ = 0;
  with rent growth the renter's spending moves with rent).
- **Owning:** rent is replaced by carrying costs at R, and any mortgage left is a finite debt, so it is
  added as its present value rather than divided by the SWR:
  `FIRE_own = (spend − 12·rent + tax(R) + insure + maint(R)) / swr + M_R`, with
  `M_R = Σ_{j = R−b}^{term−1} 12·PMT/(1+π)^j / (1+r)^(j − (R−b) + 1)` (0 when paid off by R; PMI at R
  is ignored as nearly always ended). The yearly part (before ÷ swr) floors at 0, for both numbers.
- At other ages a (for FI ages, 11.4) the same formulas with R → a; before b the renter's number.
- Both numbers freeze housing costs at R: `Rent(R)` for the renter, and tax and maintenance on `V(R)`
  for the owner. Rent growth and home price growth after R are ignored, so with `ρ` or `g` above 0 both
  are understated, and not equally (at the defaults, ρ = 0 and g = 0.5%, slightly in the owner's
  favor). Said in the caveats.
- With ρ ≠ 0 the renting column's FIRE number and FI age differ from the main plan's (which keeps
  `spend/swr`); a line under the comparison says so ("Renting here includes rent growth of X%/yr, so
  its FIRE number ($A) and FI age differ from the main plan's ($B).").

### 11.4 Outputs (`house()` returns; all shown only when `houseOn`)

- **Monthly cost in the first year of owning:** `Own(b)/12` split P&I · tax · insurance · maintenance ·
  PMI, against `Rent(b)/12`; one line "Owning costs $X/mo more (less) than renting at first."
- **Cash at closing** `D + K` (down + closing), and where it comes from.
- **FI age, renting vs buying**: the never-coast definition of 4.4 (full saving, coast ages and draw
  ignored, working past R if needed, to `top`), with the target at each age being that path's FIRE
  number at that age; the fractional age interpolates the gap `B(a) − FIRE(a)` linearly between the
  two year-ends around the sign change. Renting = `neverCoast.age` when ρ = 0 (shared code). Buying is
  the first age the household is FI **and stays FI through the purchase**: an FI age before b counts
  only if every point up to b (the balance just after closing at b) stays at or above `FIRE_own`;
  otherwise the search restarts at the last point up to b below target, interpolating from the
  post-closing gap at b.
- **Meets the coast line, renting vs buying**: for buying, the coast line at age k is the balance that,
  with no base saving from k (housing deltas, the purchase if k ≤ b, and no draw, as in 4.1), reaches
  `FIRE_own` at R; it is affine in the starting balance, so one zero-start run gives it:
  `coastBuy(k) = (FIRE_own − B⁰_R(k)) / (1+r)^(R−k)`, computed without the floor, shown clamped at 0.
- **Earliest coast age (both), renting vs buying**: `earliestCoast` (4.4) with `buyPath` and `FIRE_own`.
  A/B-alone rows stay renting-only.
- **At R:** portfolio renting vs buying; **net worth** renting = portfolio (+ credited cash) vs buying =
  portfolio + `V(R)(1 − sellPct)` − remaining balance − any cash-short debt (11.2); home value and loan
  left shown in "How this is worked out".
- **Breakeven home growth** `g*` and **breakeven mortgage rate** `i*`: the value at which net worth at
  R ties (`NW_own = NW_rent`), everything else held. Bisection to 0.01 point on [−10%, 10%] and
  [0%, 20%]. No sign change → "buying is ahead even at −10%/yr" / "renting stays ahead up to 10%/yr"
  (rate: "buying ahead even at 20%" / "renting ahead even at 0%").
- **Years owning costs more** (count of a in [b, R) with Δ > 0) and **years short** (deficit > 0) with
  the total deficit.
- `cashShort`, `afford` (first whole age ≥ b at which the renting path's balance ≥ cash at closing, or
  null), warnings: `buyAfterRet`, `buyNow`, `cashShort`, `deficit`, `noPrice` (price 0).

### 11.5 UI

A native `<details id="d-house">` in the inputs column after HSA, same pattern as the other rows:
summary title "Buying a home" and a live value from `ui.js houseSummary(res, h)`:

| State | Summary value |
|---|---|
| off | "off" (so the row reads "Buying a home · off") |
| retAge ≤ age | "fix the ages first" |
| buyAge ≥ retAge | "buy before R to compare" |
| price 0 | "add a home price" |
| cash short | "Buy at b: $X short at closing" |
| both FI ages found | "Buy at b: FI 1.2 yrs later" / "… earlier" / "same FI age" (\|diff\| < 0.05); short enough for 375px, the verdict inside says "than renting" |
| otherwise | "Buy at b: $X less (more) at R" (net worth) |

Inside, top to bottom: the switch "Compare buying a home" (with "Off: nothing on the page changes");
when on, the result first, kept short: a verdict sentence matching the summary (plain words, whole
years: "about 14 years later than renting (88 instead of 74)"), then a plain two-column list "Renting |
Buying" with hairlines and only the essentials: housing a month at first, cash at closing,
"Financially independent at" (fine note "saving at full pace, never coasting"; one decimal), net worth
at R (fine note "home counted after selling costs"); the rent-growth and cash-short lines (11.2, 11.3)
under it when they apply. Each buying value has a delta in words; the arrow follows the number (▲ more
or later, ▼ less or earlier) and the colour says good or bad for buying, never colour alone. Then a
collapsed `<details>` "How this is worked out" (summary e.g. "P&I $X/mo · owning costs more every
year") holding the rest of the list (meets the coast line, earliest coast age, portfolio at R, the two
FIRE numbers) and the notes (owning cost split, years owning costs more, "every year until R" when all
of them, the deficit "the $X gap is assumed to come out of your pay, not your portfolio", the home at R,
the cash fund credit, the FIRE-number assumption, the bridge line). Then the inputs (buy age, price,
down + source segmented, rate, term segmented, rent), then a nested `<details>` "Costs and growth"
(summary "closing 3% · selling 6% · tax 0.9% · insurance $X · upkeep 1% · growth 0.5%") with closing,
selling, tax, insurance, maintenance, mortgage insurance (PMI), appreciation, rent growth; a nested
"Breakeven" (summary "ties at home prices +4.5%/yr or a 2.2% rate") and a nested "Caveats" (11.7). When
off, the inputs are hidden, not cleared. An error inside opens it (section 3 rule). US spelling
("favors").

**Main chart (when on):** a **"Buy a home"** line = the buying path's portfolio (equity not
included), solid `--c4` (#a0549a / dark #b874b0, the validated HSA step), 2.25px, drawn from b to R,
with the drop at b drawn as a vertical step and a 7px square marker (surface halo) at the post-purchase
point labelled "buy at b" through the shared label placer: beside the square first, then 24–66px above
it with a thin leader, clear of the lines bunched near $0; if nothing fits, no label. A 14px tick at
x(R), centred on the end of the buy line, marks `FIRE_own` when it differs from the FIRE line by more
than 8px, labelled "FIRE if you buy $X" just inside the retirement line, else at the left by the axis,
else right of the tick, each clear of every placed label and line; if none fits, the label is dropped
and the legend entry carries it. Its key goes under "Other lines" ("Buy a home at b (portfolio, not the
house)", plus " · FIRE if you buy $X" when the label was dropped). The readout adds "Buying $X" when it
differs from Projected, at rest too (its value at R; it wraps at 375px); the table gains "Buying" and
"Home equity" columns (to R), and at ≤ 480px hides "Stop today" to make room (the note says so). Stop today, never
coast, the sparkline, the heatmap and the hero/KPIs stay the renting plan. Bump `sw.js` to
`coast-fire-v6`.

### 11.6 Edge cases

| Case | Behavior |
|---|---|
| buyAge ≤ age | Bought at the current age (k = 0); hint "Buying today." |
| buyAge ≥ retAge | Not modeled (after retirement there is no projection); field note, summary "buy before R to compare", no chart line. |
| Already own a home | Not supported; the buy-age hint says so. |
| downPct < 3 | Clamped to 3 (no 100% loan; 97% is the conventional maximum). downPct = 100: cash purchase, no loan or PMI. |
| mortRate = 0 | `PMT = L / N`, balance falls linearly. |
| π = 0 or < 0 | Real P&I constant (or rising); formulas hold. |
| r = 0 | Annuity and PV terms use the r = 0 forms (no division by zero). |
| Term ends after R | Remaining payments enter `FIRE_own` as `M_R`; net worth subtracts the balance. |
| Cash at closing > portfolio | `cashShort`; path floors at 0; summary leads with the shortfall; "You'd have enough at {afford}" with an Apply button when found. |
| Owning costs exceed planned saving | Contributions floor at 0, deficit years and total shown ("assumed paid from pay"). |
| Coasting or Barista draw before / after b | Unchanged; deltas still apply (coasting households still pay more or save the difference). |
| retAge < 59½ (bridge) | The bridge (section 5) stays on the renting plan; the house section adds one line "Buying, your portfolio at R is $X (renting $Y); the bridge uses the renting plan." Down payments from pre-tax money: hint above. |
| Non-finite | "Too large to show". |

### 11.7 Caveats (plain words, in the section)

Not financial advice. Mortgage interest and property-tax deductions are not modeled (most households
take the standard deduction); nor capital-gains tax on a sale, moving, refinancing or extra payments.
Selling costs count only in the net-worth line; a home is hard to sell quickly or in pieces, and its
equity can't pay for groceries in retirement without selling or borrowing. The median home and the
median asking rent are different kinds of housing (renters' homes are usually smaller), so enter the
rent for a home like the one you'd buy. Repairs come in lumps, not 1% a year. Rates, prices and rents
vary hugely by place. Both FIRE numbers hold housing costs where they are at retirement, so rent and
home price growth after that are left out (11.3).

### 11.8 Tests (added to `tests/run_tests.js`)

- 0% real return, 0% inflation, 0% mortgage rate, no tax/insurance/maintenance/PMI, rent equal to the
  payment: buying path = renting path minus the cash at closing; equity = down payment + principal paid.
- Payment: 300,000 at 6% for 30 years → 1,798.65/mo; at 0% → 833.33/mo; 15-year term.
- Real P&I falls by (1 + π) a year; PMI stops at the first year with scheduled balance ≤ 78% of price,
  pro-rated by month in the year it crosses (10.5% down at 0%: 11 of 12 months); none at 20% down.
- FI buying stays FI through the purchase: defaults with 400,000 invested, retire at 66, buy at 64 →
  renting FI near 63, buying after 64 (the post-closing balance is below `FIRE_own(64)`); with more
  invested, an FI age before b that closing keeps stands.
- Cash short: the shortfall is a debt in buying net worth (r = 0: buy NW = portfolio + home after
  selling costs − 14,000).
- Δ > C floors contributions at 0 and reports the deficit; Δ < 0 adds to contributions while coasting.
- `FIRE_own` with the loan paid off by R = (spend − rent + carry)/swr; with years left adds `M_R`.
- Breakevens: net worth ties at the returned `g*` and `i*` (within 1 dollar); no-sign-change messages.
- Edge cases of 11.6; hash round trip with the sixteen new keys; `houseSummary` strings of 11.5;
  privacy scan allowlist gains every new default and source amount below.

### 11.9 Defaults and citations (verified 2026-10-17)

With these defaults (buy at 45, 10% down from invested assets) the prototype gives: cash at closing
54,340; owning about 3,588/mo at first vs 1,530 rent; 20 years of owning costing more; portfolio at 65
about 297,000 buying vs 1,009,932 renting; net worth at 65 about 594,000 buying (home after selling
costs, loan left) vs 1,009,932; `FIRE_own` about 1.72M vs 1.78M; breakeven growth about 4.5%/yr real,
breakeven rate about 2.2% (2.22 with PMI pro-rated by month). Tests fix the exact values.

| Input | Default | Source |
|---|---|---|
| Home price | **418,000** | NAR existing-home sales, September 2026 (released 2026-10-13): median existing-home price 417,500, rounded to the slider step (Rate.com recap of the release, https://www.rate.com/mortgage/resource/housing-report-10-13-26; NAR release page https://www.nar.realtor/newsroom/existing-home-sales-fell-2-0-in-september; August 2026: 429,100, Haver Analytics https://www.haver.com/articles/u-s-existing-home-sales-decline-in-august-to-lowest-level-since-june-25). |
| Mortgage rate | **7.4%** | Freddie Mac PMMS 30-year fixed, week of 2026-10-15: 7.40% (FRED MORTGAGE30US, https://fred.stlouisfed.org/series/MORTGAGE30US). |
| Term | **30** | The PMMS benchmark loan. |
| Down payment | **10%** | NAR 2025 Profile of Home Buyers and Sellers: median down payment of first-time buyers 10% (repeat buyers 23%); the default household rents, so it would be a first-time buyer (Virginia Realtors summary, https://virginiarealtors.org/2025/12/08/key-takeaways-from-nars-2025-profile-of-home-buyers-and-sellers). |
| Buy at age | **45** | Placeholder a few years ahead (the default household is 42; NAR 2025 Profile: median first-time buyer age 40, https://www.nar.realtor/newsroom/first-time-home-buyer-share-falls-to-historic-low-of-21-median-age-rises-to-40). |
| Rent | **1,530/mo** | Census Housing Vacancy Survey, Q2 2026: "the median asking rent for vacant for rent units was" 1,531 (https://www.census.gov/housing/hvs/files/qtr226/Q226press.pdf). |
| Rent growth | **0.0%** real | Lyons, Shertzer & Gray, NBER w35124 (April 2026): a consistent rent index back to 1914 "eliminates the long-run decline in real rents", i.e. rents roughly track inflation (https://www.nber.org/papers/w35124). |
| Closing costs | **3%** | Chase: closing costs "range from 2-5% of the loan amount" (https://www.chase.com/personal/mortgage/education/financing-a-home/how-much-are-closing-costs); LodeStar 2025 report: title, settlement, recording and transfer taxes alone average 1.04% of price (4,528), lender fees and prepaids excluded (https://www.lodestarss.com/?p=17088). 3% of price sits in the 2–5%-of-loan range at 10% down. |
| Selling costs | **6%** | Agent commissions about 5–6% in total (RealTrends average 5.32% in 2022, HousingWire https://www.housingwire.com/articles/average-real-estate-commission-rate-at-highest-level-since-2013/; buy side about 2.4–2.7% since the 2024 NAR settlement) plus seller closing costs. |
| Property tax | **0.9%**/yr | ATTOM 2025 property tax analysis (2026-04-09): "Nationwide, the effective tax rate for single-family homes in 2025 was 0.9 percent" (https://www.attomdata.com/news/market-trends/home-sales-prices/2025-annual-tax-report). |
| Insurance | **1,600/yr** | NAIC homeowners report (2022 data, released 2025-05-21) via the Insurance Information Institute: average HO-3 premium 1,569 in 2022, rounded up (https://www.iii.org/fact-statistic/facts-statistics-homeowners-and-renters-insurance). Premiums have risen since; the hint says so. |
| Maintenance | **1%**/yr | Fannie Mae: budget "1% to 4% of your home's value per year" (https://yourhome.fanniemae.com/own/how-build-your-maintenance-and-repair-budget); the low end, for a typical resale home. |
| PMI | **0.6%**/yr | Freddie Mac: "approximately between $30 and $70 per month for every $100,000 borrowed" = 0.36–0.84%/yr, midpoint 0.6% (https://myhome.freddiemac.com/buying/breaking-down-pmi); same page: automatic termination at a scheduled 78% of original value. |
| Home price growth | **0.5%**/yr real | Shiller's index: real US home prices about 0.7%/yr over the period homeowners recall, and close to trendless since 1890 (0.1%/yr 1890–1996) (Wikipedia, Case–Shiller index, citing *Irrational Exuberance*, https://en.wikipedia.org/wiki/Case%E2%80%93Shiller_index); 0.5% sits between. |
| Down payment from | **Invested assets** | The conservative case: the money stops compounding in the portfolio. |

## Sources

IRS 2026 limits; Rev. Proc. 2025-19 (HSA); Treas. Reg. 1.401(a)(9)-9; IRS Notice 2022-6; IRS SEPP
page https://www.irs.gov/retirement-plans/substantially-equal-periodic-payments; Kitces, "How Notice
2022-6 Can Help 72(t) Early Distribution Planning"
https://www.kitces.com/blog/rule-72t-sepp-calculate-payments-rmd-avoid-penalty-tax-early-ira-withdrawals-notice-2022-6/;
BLS (earnings, CPS 11b, CE via FRED); Federal Reserve SCF 2022; Vanguard How America Saves 2025;
CRS R48051; Devenir 2025 year-end HSA report; SSA Trustees economic assumptions; for the home
(section 11.9): NAR, Freddie Mac PMMS and PMI pages, Census HVS, NBER w35124, Chase, LodeStar, RealTrends,
ATTOM, NAIC via III, Fannie Mae, Shiller; WalletBurst,
Pelcro and Liberated Stock Trader Coast FIRE calculators.
