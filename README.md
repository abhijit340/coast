# Coast FIRE

Live at https://coast-aj.pages.dev (Cloudflare Pages; every push to main redeploys).

A two-income Coast FIRE calculator. It answers: *if we both stopped saving for retirement, would what we have grow into enough by the time we retire? If not yet, when could we stop, and what would it take?* It also plans an early-retirement bridge to 59½ with Rule 72(t) payments and a Roth conversion ladder.

Live at: `https://<project>.pages.dev/` (Cloudflare Pages, site root = repo root).

It's a static page: plain HTML, CSS and JavaScript, with no build step, frameworks, CDN, fonts or analytics. It installs to a phone's home screen and works offline. Nothing you type leaves the browser.

## Using it

The first screen holds only the answer and the chart. Everything else is still there, folded into rows that each show a live one-line value ("Contributions · $22,784/yr", "Returns 7.0% · inflation 2.4% · withdraw 4.0%"); tap a row to open it. Which rows are open is remembered on this device, separately from your numbers.

- **Answer first.** A progress ring, a status chip (On track / Coasting now / Not before 65 / $X short), the earliest age you could both stop saving, and one sentence about that same scenario. When nothing works yet (the case with the median defaults), it says how far short you are and the closest single steps, with a link to all of them.
- **Ways to reach your goal** (a closed row right under the answer; its summary shows the best step, e.g. "Best: save $19.7K/yr more (5 accounts)"): pick a goal (retire by your retirement age, both coast by an age, or retire as early as possible; by default it's picked from your plan) and each lever is solved for the smallest change that gets there: save more (split in a common general order: HSA, Roth IRAs, 401(k)s, then taxable, within the 2026 limits and each person's pay), spend less, retire later, keep saving longer (together or one partner), draw less while coasting, and with Buying a home on: buy later, a cheaper home, a bigger down payment or renting. Ranked by effort, up to six cards, with "Two smaller steps" when no single one is small (ranked by its own effort, so it can come first); options outside a plausible range (retiring after 80, spending under a floor, a home under a quarter of the price, a down payment the portfolio can't cover) are listed as "Not on its own" instead of as cards; each shows the exact numbers, the effect and what to watch for, and **Apply** sets the inputs (with Undo). On track, it flips to what you could do with the head start (coast sooner, retire sooner, spend or save less). The return or withdrawal rate the plan would need is shown for reference only. Educational estimates from this model, not financial advice: taxes, catch-up contributions, income limits and account rules aren't modeled and can change what makes sense.
- **Your numbers:** ages, invested money and retirement spending; then collapsed rows for returns, inflation & withdrawals and for an optional Barista FIRE draw while coasting. A field's (i) shows its note.
- **Partners A and B** (stack on phones): salary and a total line shown; 401(k), employer %, Roth IRA and an optional "Coast from an age" in a collapsed row, with "Keep saving after coasting" (% of before). The × or the Two incomes switch makes it a one-person plan. Legal limits show as a tick and label on the slider; typing over one clamps with a note.
- **Sliders on phones:** a vertical swipe across a slider scrolls the page, a tap on the track does nothing, and only a sideways drag that starts on the thumb moves it (the thumb glows and the number box lights up), with a toast to Undo it; a drag the phone interrupts puts the value back. The number box is the precise way in; arrow keys and screen readers work as before.
- **HSA:** one collapsed row for the household; Family (one $8,750 limit) or Self-only ($4,400 each). **Other investing** (taxable brokerage saving, $/yr) is the row after it.
- **Go deeper** (collapsed rows below the inputs, or on the right on wide screens): contributions, earliest coast age, what-if table, the bridge, and how it works.
- **Earliest coast age:** solved for both together and for each partner alone (the other's plan held as set), each with an **Apply** button that sets the coast switches and ages.
- **Your path (main chart):** your plan, the coast line, "if you stop today", and a dashed teal **Keep saving, never coast** line: everyone keeps their full saving for good (no coast ages, no Barista draw), working past the retirement age if needed. A dot marks where it reaches the FIRE number ("Keep saving → retire at 75"), and the age axis runs past retirement far enough to show it. The **Never coast** tile says "you could retire at about N" and how that compares with your chosen age (or "Not by 100"). Drag or use the arrow keys for a readout; **Show as a table** lists every age.
- **What if returns or withdrawals differ?** A real table: rows are the investment return before inflation, columns the safe withdrawal rate, each header with its unit, and a caption saying what a cell means (the earliest age you could both stop saving). Shade = years of coasting, hatched = can't reach the FIRE number even saving the whole way (the % shows how much you'd have), and the cell for your own inputs is outlined and labelled "your inputs". A legend under the table explains all three.
- **Buying a home** (off by default; one collapsed row after the HSA): switch it on to compare buying a home at an age against renting. Price, down payment (from invested money or a separate cash fund), mortgage rate and 15/30-year term, rent today, and under "Costs and growth" closing and selling costs, property tax, insurance, maintenance, mortgage insurance (PMI), home-price and rent growth above inflation. Each year the difference between owning (payment, tax, insurance, upkeep, PMI) and rent comes out of, or adds to, saving. Your retirement spending is taken to include today's rent; an owner's FIRE number swaps the rent for the home's running costs plus any mortgage still due. The row's summary gives the verdict ("Buy at 45: FI 13.6 yrs later"); inside, a short renting vs buying list (monthly cost, cash at closing, FI age, net worth at retirement), then "How this is worked out" (coast ages, portfolio at retirement, the two FIRE numbers and the notes), breakeven home growth and mortgage rate, and caveats. The chart adds a "Buy a home" line (the portfolio, never the house), with a column for it and home equity in the table. Not advice; taxes and the mortgage-interest deduction aren't modeled.
- **Retire before 59½:** shown when the retirement age is under 59½ (otherwise a teaser card). Splits pre-tax money into a 72(t) IRA and a ladder IRA, then shows each year to 59½: 72(t) (fixed, locked), taxable, Roth basis, ripe ladder rungs, and any gap year with the amount.
- **How you compare** (the last row on the page, closed; its summary reads e.g. "~55th percentile for your age"): your numbers next to published US surveys of people your age, worked out on the device. Seven rows, each with a live value, one plain sentence, one small chart and its sources: invested assets (Federal Reserve SCF financial assets for your age band, with the couples' median and top 10%), retirement accounts (SCF, counting people with none, couples' figures for two incomes, plus the median among those who have one), saving rate (401(k) + employer vs Vanguard and Fidelity savers, Vanguard's income-based target, the share who max out), household income (Census percentile ladder, married-couple or single median, and each salary against full-time workers), savings as a multiple of pay (Fidelity's guideline, labelled as a rule of thumb), retirement age (EBRI expected 65 vs actual 62, Gallup, CRR) and retirement spending (BLS spending of 65+ households, and what one average Social Security benefit covers). Percentiles are interpolated between published points (log scale for dollars), never extrapolated past them; older dollars are raised to today's with CPI-U. Approximate, for context only.
- Inputs are remembered in this browser only (`localStorage` key `coastfire.v2`). **Reset** (top right, or below the inputs) restores the defaults, with Undo. **Copy link** puts the numbers after `#` (on a phone, the share sheet), e.g. `#a=42&r=65&b=45000&s=71000&sa=62608&ka=4800`. Opening a link shows its numbers with a banner and leaves your saved numbers alone until you edit or keep them. v1 links still open.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `style.css` | Styles; light and dark follow the system setting |
| `benchmarks.js` | Published US survey figures for "How you compare" (data only, `window.CoastBench`), each series with its year, dollars year and source link |
| `calc.js` | All the math, pure functions, no DOM. `window.CoastFire` in the browser, `require("./calc.js")` in node. Holds the 2026 limits and the IRS Single Life Table (ages 30–60) |
| `ui.js` | The one-line summaries on collapsed rows and the saved open/closed state; pure, tested in node |
| `app.js` | Builds the fields, keeps boxes and sliders in sync, writes results, draws the SVG charts, saves inputs |
| `sw.js` | Service worker: network first, saved copy after 3 s or offline. Bump `CACHE` (now `coast-fire-v9`) whenever the files change |
| `manifest.webmanifest`, `icons/` | Home-screen install. `python tools/make_icons.py` (needs Pillow) redraws the icons |
| `privacy.html` | Privacy note |
| `tests/run_tests.js` | Tests |
| `SPEC.md` | Inputs, formulas, design, and the cited defaults |

## Tests

```
node tests/run_tests.js
```

No packages needed. Hand-checked cases for two incomes, coast downshifts, the family vs self-only HSA, the Barista draw, the earliest-coast-age solver (together and each partner alone), the 72(t) payment ($1,000,000 at 45, 5%, life expectancy 41.0 → $57,822.29), a bridge timeline with gap years and ladder rungs, and rent vs buy (mortgage payment and balance, PMI drop-off at 78%, owning costs flowing into saving with a floor at 0, the owner's FIRE number, breakevens that tie net worth, equity after selling costs, and that switching it off changes nothing else), the suggestions engine (each lever's solved change meets the goal and one step less doesn't, the account waterfall within the limits, on-track room, impossible cases, house levers only when buying, the defaults' $19,700 / $40,300 / 75 and an 11.1% return needed for reference, and a speed bound); how you compare (CPI factors, age bands, log vs linear percentile interpolation with its edges: below the lowest cutpoint, zeros, the top, a Pareto tail; Fidelity's guideline between ages; couples vs single; and each of the seven comparisons at the defaults against a hand formula); closed-form and brute-force cross-checks; limits, clamps, the URL hash, slider scale and formatting; the touch-slider gestures (tap, sideways drag, vertical swipe, near-thumb hit test, a cancelled drag putting the value back); that the defaults equal the cited table and the Single Life values match the regulation; and a privacy scan that fails on spreadsheets or on any dollar amount or 4+ digit number not on its allowlist (a published figure from `benchmarks.js` passes only if it is also written in `SPEC.md` section 13).

To preview, serve the folder (`python -m http.server 8000`) and open http://localhost:8000/.

## The math, briefly

All in today's dollars. Real return *r* = (1 + return) / (1 + inflation) − 1. FIRE number = spending ÷ withdrawal rate. Each year: balance × (1 + *r*) + that year's contributions (each partner's 401(k) + employer + Roth, changing at their coast age, plus the HSA) − any Barista draw. The coast line is the FIRE number discounted to each age. 72(t): fixed amortization, payment = B·i / (1 − (1 + i)^−LE), fixed in dollars so it shrinks in today's dollars. Details in `SPEC.md`.

## Where the defaults come from

US medians or typical figures, never anyone's own numbers (a test enforces it). Full citations in `SPEC.md` section 8.

| Input | Default | Source |
|---|---|---|
| Salary, each | $62,608 | BLS median full-time weekly earnings 2025, $1,204 × 52 |
| 401(k) | $4,800 (7.7%) | Vanguard *How America Saves 2025*, average deferral rate |
| Employer | 4.3% | Same report: 12.0% total − 7.7% |
| Roth IRA | $3,200 | IRS data via CRS R48051: average for filers 35–49, $3,211 (2022) |
| HSA (family) | $1,400 | Devenir: about 60 billion dollars contributed across 41.7M accounts in 2025 ≈ $1,440 |
| Invested | $45,000 | Fed SCF 2022, median retirement accounts, ages 35–44 |
| Age | 42 | BLS median age of employed workers, 2025 |
| Spending | $71,000 | BLS CE 2024, two-person households: $80,830 − $9,652 pension/Social Security contributions |
| Inflation | 2.4% | Social Security Trustees' long-run intermediate CPI assumption |
| Return / withdrawal / retirement | 7% / 4% / 65 | Common planning figures |
| Home (when on) | $418,000 · 10% down · 7.4% · 30 yrs · rent $1,530/mo | NAR median existing-home price (Sep 2026), NAR first-time buyers, Freddie Mac PMMS, Census median asking rent |
| Home costs | tax 0.9% · insurance $1,600 · upkeep 1% · PMI 0.6% · closing 3% · selling 6% · growth 0.5% real · rent growth 0% | ATTOM, NAIC via III, Fannie Mae, Freddie Mac, Chase, RealTrends, Shiller, NBER (SPEC section 11.9) |
| 2026 limits | $24,500 / $7,500 / $4,400 & $8,750 | IRS; Rev. Proc. 2025-19 |

With these numbers the household does not reach its FIRE number by 65; the page treats that as a designed state, not an error.

## How you compare: sources

Every figure is in `benchmarks.js` with its data year and link, and written out in `SPEC.md` section 13.5. Dollar figures from earlier years are raised to today's (September 2026) with the BLS CPI-U; rates, ages and 2026 figures are used as published.

| Comparison | Source |
|---|---|
| Invested assets, retirement accounts | Federal Reserve, [Survey of Consumer Finances 2025](https://www.federalreserve.gov/publications/files/scf26.pdf): financial assets and retirement accounts by age, all families and couples (percentiles computed from the [public data](https://www.federalreserve.gov/econres/files/scfp2025excel.zip)) |
| Saving rate | Vanguard, [How America Saves 2026](https://workplace.vanguard.com/content/dam/inst/iig-transformation/has/2026/pdf/HowAmericaSaves2026.pdf) (2025); [Fidelity Q2 2026 Retirement Analysis](https://about.fidelity.com/data-and-insights/q2-2026-retirement-analysis) |
| Household income, pay | Census, Income in the United States: 2025 (P60-289), [Table 1](https://www2.census.gov/programs-surveys/demo/tables/p60/289/table1.xlsx), [Table 5](https://www2.census.gov/programs-surveys/demo/tables/p60/289/table5.xlsx), [Table 11](https://www2.census.gov/programs-surveys/demo/tables/p60/289/table11.xlsx); BLS [Usual Weekly Earnings, Q2 2026](https://www.bls.gov/news.release/wkyeng.t05.htm) |
| Savings vs. pay | Fidelity, [How much do I need to save for retirement?](https://www.fidelity.com/viewpoints/retirement/retirement-guidelines) (a guideline, not an average) |
| Retirement age | EBRI, [2026 Retirement Confidence Survey](https://www.ebri.org/docs/default-source/rcs/2026-rcs/2026-rcs-release-report.pdf); Gallup [2022](https://news.gallup.com/poll/394943/retiring-planning-retire-later.aspx) and [2018](https://news.gallup.com/poll/234302/snapshot-americans-project-average-retirement-age.aspx); Boston College [CRR](https://crr.bc.edu/will-the-average-retirement-age-keep-rising/) |
| Retirement spending | BLS [Consumer Expenditure Survey 2024 by age](https://www.bls.gov/cex/tables/calendar-year/mean-item-share-average-standard-error/reference-person-age-ranges-2024.xlsx); SSA [Monthly Statistical Snapshot](https://www.ssa.gov/policy/docs/quickfacts/stat_snapshot/) (Sep 2026) |
| Today's dollars | BLS [CPI-U, CUUR0000SA0](https://data.bls.gov/timeseries/CUUR0000SA0) |

This is a planning toy, not financial or tax advice.
