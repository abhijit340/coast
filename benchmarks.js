// "How you compare": published US benchmarks (SPEC 13). Data only, no code that reads
// the page, so the same file runs in the browser (window.CoastBench) and in node.
//
// Every figure is a public survey statistic, copied from the source named on its series
// (compiled 2026-10-17; the Federal Reserve SCF 2025 is the anchor). Each series says its
// data year and the dollars it is in: `dollars: 2025` means 2025 dollars (inflated to
// today with `cpi` below), `dollars: null` means current dollars of its own date or a rate,
// never inflated. Percentile keys are p10..p99; a value that is a mean is called `mean`
// and is never used as a percentile cutpoint. Age bands are [min, max] inclusive (120 =
// open-ended). Every number here is also written in SPEC.md section 13 (a test checks).
(function (root) {
  "use strict";

  const deepFreeze = (o) => { Object.values(o).forEach((x) => { if (x && typeof x === "object") deepFreeze(x); }); return Object.freeze(o); };

  const BENCH = {
    compiled: "2026-10-17",

    // CPI-U, US city average, all items, NSA (BLS CUUR0000SA0). today = value x target / annual average.
    // Stored, not fetched: the page never calls out. Refresh `target` when the data is updated.
    cpi: {
      target: { period: "2026-09", value: 336.940 },
      annual: { 2022: 292.655, 2023: 304.702, 2024: 313.689, 2025: 321.943 },
      src: "bls_cpi",
    },

    sources: {
      bls_cpi: { label: "BLS CPI-U (CUUR0000SA0)", url: "https://data.bls.gov/timeseries/CUUR0000SA0" },
      scf_micro: { label: "Federal Reserve, SCF 2025 public data (percentiles computed)", url: "https://www.federalreserve.gov/econres/files/scfp2025excel.zip" },
      scf_tables: { label: "Federal Reserve, SCF 2025 tables", url: "https://www.federalreserve.gov/econres/files/scf2025_tables_internal_real_historical.xlsx" },
      scf_bulletin: { label: "Federal Reserve, SCF 2025 bulletin", url: "https://www.federalreserve.gov/publications/files/scf26.pdf" },
      census_t1: { label: "Census, Income in the United States: 2025 (P60-289), Table 1", url: "https://www2.census.gov/programs-surveys/demo/tables/p60/289/table1.xlsx" },
      census_t5: { label: "Census P60-289, Table 5 (income distribution)", url: "https://www2.census.gov/programs-surveys/demo/tables/p60/289/table5.xlsx" },
      census_t11: { label: "Census P60-289, Table 11 (earnings)", url: "https://www2.census.gov/programs-surveys/demo/tables/p60/289/table11.xlsx" },
      bls_weekly: { label: "BLS Usual Weekly Earnings, Q2 2026", url: "https://www.bls.gov/news.release/wkyeng.t05.htm" },
      vanguard: { label: "Vanguard, How America Saves 2026", url: "https://workplace.vanguard.com/content/dam/inst/iig-transformation/has/2026/pdf/HowAmericaSaves2026.pdf" },
      fidelity: { label: "Fidelity Q2 2026 Retirement Analysis", url: "https://about.fidelity.com/data-and-insights/q2-2026-retirement-analysis" },
      fidelity_guide: { label: "Fidelity, How much do I need to save for retirement?", url: "https://www.fidelity.com/viewpoints/retirement/retirement-guidelines" },
      ebri: { label: "EBRI 2026 Retirement Confidence Survey", url: "https://www.ebri.org/docs/default-source/rcs/2026-rcs/2026-rcs-release-report.pdf" },
      gallup2022: { label: "Gallup, April 2022 retirement poll", url: "https://news.gallup.com/poll/394943/retiring-planning-retire-later.aspx" },
      gallup2018: { label: "Gallup, April 2018 retirement snapshot", url: "https://news.gallup.com/poll/234302/snapshot-americans-project-average-retirement-age.aspx" },
      crr: { label: "Boston College CRR, Issue in Brief 25-8", url: "https://crr.bc.edu/will-the-average-retirement-age-keep-rising/" },
      bls_ce: { label: "BLS Consumer Expenditure Survey 2024, by age", url: "https://www.bls.gov/cex/tables/calendar-year/mean-item-share-average-standard-error/reference-person-age-ranges-2024.xlsx" },
      ssa: { label: "SSA Monthly Statistical Snapshot, Sep 2026", url: "https://www.ssa.gov/policy/docs/quickfacts/stat_snapshot/" },
    },

    // 1. SCF financial assets (cash, investments, retirement accounts, cash-value life insurance;
    // no home equity), all families by age of the reference person, zeros included.
    financialAssets: {
      year: 2025, dollars: 2025, src: "scf_micro",
      bands: [
        { age: [18, 34], p25: 1520, p50: 12100, p75: 54500, p90: 163981 },
        { age: [35, 44], p25: 3000, p50: 31300, p75: 163000, p90: 579800 },
        { age: [45, 54], p25: 5300, p50: 73500, p75: 410000, p90: 1141000 },
        { age: [55, 64], p25: 3600, p50: 87020, p75: 664900, p90: 1950000 },
        { age: [65, 74], p25: 5000, p50: 80600, p75: 523000, p90: 2037600 },
        { age: [75, 120], p25: 4290, p50: 96000, p75: 711900, p90: 2426000 },
      ],
      // Married or cohabiting couples (small cells: indicative).
      couples: [
        { age: [18, 34], p50: 20001, p90: 245120 },
        { age: [35, 44], p50: 58300, p90: 789770 },
        { age: [45, 54], p50: 141510, p90: 2150100 },
        { age: [55, 64], p50: 310300, p90: 4172500 },
        { age: [65, 74], p50: 195000, p90: 3190500 },
        { age: [75, 120], p50: 259800, p90: 3917600 },
      ],
    },

    // 2. SCF retirement accounts (IRA/Keogh, 401(k)/403(b)/thrift, account-type pensions; no HSA,
    // no DB pension). `uncond` counts families with no account as 0; `holding` is the % with one
    // (published) and `condMedian` the median among holders (published for all families,
    // computed for couples).
    retirementAccounts: {
      year: 2025, dollars: 2025, src: "scf_micro",
      bands: [
        { age: [18, 34], holding: 48.8, condMedian: 21000, uncond: { p25: 0, p50: 0, p75: 19000, p90: 75000 } },
        { age: [35, 44], holding: 59.6, condMedian: 61200, uncond: { p25: 0, p50: 7000, p75: 95000, p90: 326000 } },
        { age: [45, 54], holding: 63.0, condMedian: 133000, uncond: { p25: 0, p50: 37000, p75: 202000, p90: 713000 } },
        { age: [55, 64], holding: 63.1, condMedian: 239000, uncond: { p25: 0, p50: 45000, p75: 400000, p90: 1260000 } },
        { age: [65, 74], holding: 49.0, condMedian: 257000, uncond: { p25: 0, p50: 0, p75: 251000, p90: 1175000 } },
        { age: [75, 120], holding: 44.6, condMedian: 257000, uncond: { p25: 0, p50: 0, p75: 175000, p90: 1125000 } },
      ],
      // Couples: no unconditional percentiles were computed for 65 and up (null: use all families).
      couples: [
        { age: [18, 34], holding: 57.7, condMedian: 30500, uncond: { p50: 3300, p75: 35000, p90: 109000 } },
        { age: [35, 44], holding: 68.4, condMedian: 80000, uncond: { p50: 25000, p75: 163000, p90: 460000 } },
        { age: [45, 54], holding: 74.5, condMedian: 200000, uncond: { p50: 98000, p75: 404000, p90: 1057000 } },
        { age: [55, 64], holding: 74.6, condMedian: 377000, uncond: { p50: 140000, p75: 700000, p90: 1850000 } },
        { age: [65, 74], holding: 61.1, condMedian: 300000, uncond: null },
        { age: [75, 120], holding: 57.2, condMedian: 436000, uncond: null },
      ],
    },

    // 3. Workplace-plan saving rates, % of pay. Vanguard: participants in its plans, 2025.
    // Fidelity: its 401(k) participants, Q2 2026. Rates are never inflated.
    savingRates: {
      vanguard: {
        year: 2025, src: "vanguard",
        total: { mean: 12.1, median: 11.6 },         // employee + employer
        totalInclNonParticipants: 10.2,              // eligible non-participants counted as 0
        deferral: { mean: 7.6, median: 6.6 },        // employee only
        deferralByAge: [
          { age: [18, 24], mean: 5.5 }, { age: [25, 34], mean: 6.7 }, { age: [35, 44], mean: 7.2 },
          { age: [45, 54], mean: 7.9 }, { age: [55, 64], mean: 9.3 }, { age: [65, 120], mean: 10.1 },
        ],
        atMax: 14,                                   // % of participants at the 402(g) limit
        atMaxByAge: [
          { age: [18, 24], pct: 2 }, { age: [25, 34], pct: 10 }, { age: [35, 44], pct: 15 },
          { age: [45, 54], pct: 17 }, { age: [55, 64], pct: 19 }, { age: [65, 120], pct: 18 },
        ],
        atMaxHighPay: { floor: 150000, pct: 51 },    // % of those earning $150K or more
        // Income-based target (employee + employer, or at the limit): 9% under $50K pay,
        // 12% from $50K to $100K, 15% over $100K. 51% of participants meet it.
        target: { under: 50000, over: 100000, rates: [9, 12, 15], meetPct: 51 },
      },
      fidelity: { year: 2026, src: "fidelity", total: 14.4, employee: 9.6, employer: 4.8 },
    },

    // 4. Census CPS ASEC 2026: household income in 2025 (all money income before tax).
    householdIncome: {
      year: 2025, dollars: 2025, src: "census_t5",
      all: { p10: 20010, p20: 35800, p40: 68600, p50: 87460, p60: 110300, p80: 182400, p90: 261300, p95: 354000 },
      byAge: [
        { age: [15, 24], median: 60870 }, { age: [25, 34], median: 94880 }, { age: [35, 44], median: 114100 },
        { age: [45, 54], median: 120100 }, { age: [55, 64], median: 99320 }, { age: [65, 74], median: 68800 },
        { age: [75, 120], median: 50880 },
      ],
      marriedCouple: 132400,   // married-couple households (not only two earners)
      nonfamily: 52200,        // nonfamily households (mostly one person): the single-person proxy
      srcMedians: "census_t1",
    },
    // Each person's pay. Census: median earnings of full-time, year-round workers in 2025, by age.
    // BLS: usual weekly earnings of full-time wage and salary workers, Q2 2026 (x 52 for a year).
    earnings: {
      ftyr: {
        year: 2025, dollars: 2025, src: "census_t11",
        byAge: [
          { age: [15, 24], median: 40580 }, { age: [25, 34], median: 61020 }, { age: [35, 44], median: 74910 },
          { age: [45, 54], median: 75500 }, { age: [55, 64], median: 71500 }, { age: [65, 120], median: 68240 },
        ],
      },
      blsWeekly: {
        year: 2026, period: "Q2 2026", dollars: null, src: "bls_weekly", weeks: 52,
        age16plus: { p10: 642, p25: 850, p50: 1251, p75: 1915, p90: 2924 },
        age25plus: { p10: 671, p25: 893, p50: 1330, p75: 2004, p90: 3082 },
      },
    },

    // 5. Fidelity's savings guideline (a rule of thumb, not what people have): savings as a
    // multiple of salary by age, assuming saving 15% from 25 and retiring at 67.
    fidelityGuide: { asOf: "2026-07-10", src: "fidelity_guide", points: [[30, 1], [40, 3], [50, 6], [60, 8], [67, 10]] },

    // 6. Retirement ages (surveys; ages and %, nothing inflated).
    retirementAge: {
      ebri: { year: 2026, src: "ebri", expectedMedian: 65, actualMedian: 62, earlierThanPlanned: 46, healthReason: 41 },
      gallup: { year: 2022, src: "gallup2022", expectedMean: 66, actualMean: 61 },
      gallupBefore60: { year: 2018, src: "gallup2018", pct: 12 },
      crr: { year: 2024, src: "crr", men: 64.6, women: 62.6 },
    },

    // 7. Spending of households headed by someone 65+ (mean per consumer unit, 2024 dollars),
    // and the average Social Security retired-worker benefit (current dollars, Sep 2026).
    spending: {
      year: 2024, dollars: 2024, src: "bls_ce",
      age65plus: 61432, age65to74: 65354, age75plus: 55834, people65plus: 1.8,
      // 65+ total without "personal insurance and pensions" (mostly payroll and pension contributions).
      age65plusCore: 57952,
    },
    socialSecurity: { period: "Sep 2026", dollars: null, src: "ssa", avgRetiredWorkerMonthly: 2088.79 },
  };

  const api = deepFreeze(BENCH);
  root.CoastBench = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
