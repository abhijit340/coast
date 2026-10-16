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
  `coast-fire-v5`), `manifest.webmanifest`, `icons/` (made by `tools/make_icons.py`), `privacy.html`,
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
Barista draw; each partner's 401(k), employer, Roth and coast plan; HSA; and a "Go deeper" list:
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

## 8. Default values and citations (verified 2026-10-16)

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
accounts or a server.

## Sources

IRS 2026 limits; Rev. Proc. 2025-19 (HSA); Treas. Reg. 1.401(a)(9)-9; IRS Notice 2022-6; IRS SEPP
page https://www.irs.gov/retirement-plans/substantially-equal-periodic-payments; Kitces, "How Notice
2022-6 Can Help 72(t) Early Distribution Planning"
https://www.kitces.com/blog/rule-72t-sepp-calculate-payments-rmd-avoid-penalty-tax-early-ira-withdrawals-notice-2022-6/;
BLS (earnings, CPS 11b, CE via FRED); Federal Reserve SCF 2022; Vanguard How America Saves 2025;
CRS R48051; Devenir 2025 year-end HSA report; SSA Trustees economic assumptions; WalletBurst,
Pelcro and Liberated Stock Trader Coast FIRE calculators.
