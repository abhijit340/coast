/**
 * Checks for the Coast FIRE math (calc.js) and a privacy scan of the repo.
 *
 *   node tests/run_tests.js
 *
 * calc.js is loaded the way the browser loads it (a plain script in a fresh
 * context), so these tests exercise exactly the file the page uses.
 * Prints a PASS/FAIL line per check and "N passed, M failed"; exits 1 on any failure.
 *
 * Most scenarios use a 0% real return (nominal == inflation) so every expected
 * value can be added up by hand; the rest are checked against closed forms.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "calc.js"), "utf8"), sandbox, { filename: "calc.js" });
const CF = sandbox.CoastFire;
// ui.js (summary lines, saved open/closed state) loads after calc.js, as in the page.
vm.runInContext(fs.readFileSync(path.join(ROOT, "ui.js"), "utf8"), sandbox, { filename: "ui.js" });
const UI = sandbox.CoastUI;
// benchmarks.js (published US figures for "How you compare", SPEC 13) loads first in the page.
vm.runInContext(fs.readFileSync(path.join(ROOT, "benchmarks.js"), "utf8"), sandbox, { filename: "benchmarks.js" });
const BENCH = sandbox.CoastBench;

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log("PASS " + name); }
  else { failed++; console.log("FAIL " + name + (detail ? " -- " + detail : "")); }
}
const near = (a, b, tol = 0.01) => Number.isFinite(a) && Math.abs(a - b) <= tol;
function eq(name, got, want, tol = 0.01) { check(name, near(got, want, tol), `got ${got}, want ${want}`); }
const J = (x) => JSON.stringify(x);

// Seeded random numbers, so a failure can be reproduced.
let seed = 20261016;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const between = (lo, hi) => lo + (hi - lo) * rand();

// ---------- defaults: cited US medians (SPEC 8), never anyone's own numbers ----------
const TABLE = {
  age: 42, retAge: 65, assets: 45000, spend: 71000, nominal: 7, inflation: 2.4, swr: 4, draw: 0,
  two: 1, hsaFamily: 1, hsa: 1400,
  salA: 62608, kA: 4800, empA: 4.3, rothA: 3200, coastOnA: 0, coastAgeA: 55, afterA: 0,
  salB: 62608, kB: 4800, empB: 4.3, rothB: 3200, coastOnB: 0, coastAgeB: 55, afterB: 0,
  preShare: 90, sepShare: 50, sepRate: 5, basis: 0, taxable: 0, lead: 0,
  // the home, off by default (SPEC 11.9)
  houseOn: 0, buyAge: 45, price: 418000, downPct: 10, downFrom: 1, mortRate: 7.4, term: 30,
  pmi: 0.6, closePct: 3, sellPct: 6, propTax: 0.9, insure: 1600, maint: 1, apprec: 0.5,
  rent: 1530, rentGrowth: 0,
  // suggestions (SPEC 12): goal picked from the plan, no taxable saving
  goal: 0, goalAge: 55, taxSave: 0,
};
check("defaults equal the cited table (SPEC 8, 11.9)", J(CF.DEFAULTS) === J(TABLE), J(CF.DEFAULTS));
check("defaults are frozen", Object.isFrozen(CF.DEFAULTS));
check("project({}) uses the defaults", J(CF.project({}).inputs) === J(TABLE));
check("2026 limits: 401(k) 24,500, IRA 7,500, HSA 4,400 / 8,750",
  CF.LIMITS.k401 === 24500 && CF.LIMITS.roth === 7500 && CF.LIMITS.hsaSelf === 4400 && CF.LIMITS.hsaFamily === 8750);
check("401(k) and Roth fields are capped at the legal limit",
  CF.FIELDS.kA.max === 24500 && CF.FIELDS.kB.sMax === 24500 && CF.FIELDS.rothA.max === 7500 && CF.FIELDS.rothB.sMax === 7500);

// IRS Single Life Table, Treas. Reg. 1.401(a)(9)-9(b), ages 30-60 (checked against the regulation text).
const SLT = [55.3, 54.4, 53.4, 52.5, 51.5, 50.5, 49.6, 48.6, 47.7, 46.7, 45.7, 44.8, 43.8, 42.9, 41.9, 41.0,
  40.0, 39.0, 38.1, 37.1, 36.2, 35.3, 34.3, 33.4, 32.5, 31.6, 30.6, 29.8, 28.9, 28.0, 27.1];
check("Single Life Table ages 30-60 match the regulation",
  SLT.every((le, i) => CF.SINGLE_LIFE[30 + i] === le) && Object.keys(CF.SINGLE_LIFE).length === 31);
check("life expectancy outside 30-60 is not guessed", CF.lifeExpectancy(29) === null && CF.lifeExpectancy(61) === null &&
  CF.lifeExpectancy(45) === 41.0);

// ---------- building blocks ----------
eq("real return 7% nominal, 2.4% inflation (Fisher)", CF.realReturn(0.07, 0.024), 0.044921875, 1e-12);
eq("real return 7%, 3% (v1 value)", CF.realReturn(0.07, 0.03), 0.0388349515, 1e-10);
eq("real return is 0 when nominal == inflation", CF.realReturn(0.03, 0.03), 0, 1e-15);
eq("FIRE number = spend / rate", CF.fireNumber(71000, 0.04), 1775000);
eq("FIRE number: rate floors at 0.1%", CF.fireNumber(1000, 0), 1000000);
eq("coast number: 1,000,000 discounted 2 years at 5%", CF.coastNumber(1e6, 0.05, 2), 907029.48);
eq("coast number never uses negative years", CF.coastNumber(1e6, 0.05, -3), 1e6);
eq("annuity factor at 0% is n", CF.annuityFactor(0, 7), 7);
eq("annuity factor 5%, 2 years = 2.05", CF.annuityFactor(0.05, 2), 2.05, 1e-12);

// ---------- two incomes, hand-added (0% real return) ----------
// A: $100,000 salary, $10,000 401(k), 5% employer = $5,000, $5,000 Roth -> $20,000/yr
// B: $50,000 salary, $5,000 401(k), 2% employer = $1,000, $0 Roth      -> $6,000/yr
// Family HSA $2,000. Household: $28,000/yr. Ages 40 -> 50 (10 years), $100,000 invested.
const H0 = {
  age: 40, retAge: 50, assets: 100000, spend: 20000, nominal: 3, inflation: 3, swr: 5, draw: 0,
  two: 1, hsaFamily: 1, hsa: 2000,
  salA: 100000, kA: 10000, empA: 5, rothA: 5000, coastOnA: 0, coastAgeA: 45, afterA: 0,
  salB: 50000, kB: 5000, empB: 2, rothB: 0, coastOnB: 0, coastAgeB: 45, afterB: 0,
  preShare: 70, sepShare: 50, sepRate: 5, basis: 0, taxable: 0, lead: 0,
};
const T1 = CF.project(H0);
eq("two incomes: A saves 20,000/yr", T1.base.A.total, 20000);
eq("two incomes: B saves 6,000/yr", T1.base.B.total, 6000);
eq("two incomes: household total 28,000/yr", T1.start.total, 28000);
check("two incomes: split by source (401k 15,000, employer 6,000, Roth 5,000, HSA 2,000)",
  near(T1.start.k401, 15000) && near(T1.start.employer, 6000) && near(T1.start.roth, 5000) && near(T1.start.hsa, 2000));
eq("two incomes: 100,000 + 10 x 28,000 = 380,000 at 50", T1.balanceAtRet, 380000);
eq("two incomes: FIRE 20,000 / 5% = 400,000", T1.fire, 400000);
eq("two incomes: r = 0 so the coast number is the FIRE number", T1.coastNow, 400000);
eq("two incomes: short 20,000", T1.surplus, -20000);
check("two incomes: one point per year, 11 points", T1.points.length === 11 && T1.points[10].age === 50);
eq("single person: 100,000 + 10 x (20,000 + 2,000) = 320,000", CF.project({ ...H0, two: 0 }).balanceAtRet, 320000);
check("single person: no B solver rows", CF.project({ ...H0, two: 0 }).earliest.B === undefined);

// ---------- coast downshift ----------
// A coasts at 45, keeping 50%: A's 5 years from 45 drop by 10,000 each -> 380,000 - 50,000.
eq("downshift: A coasts at 45 at 50% -> 330,000", CF.project({ ...H0, coastOnA: 1, afterA: 50 }).balanceAtRet, 330000);
// Both stop at 45: 5 years of 28,000 (family HSA stops with the last partner).
eq("downshift: both stop at 45 -> 240,000", CF.project({ ...H0, coastOnA: 1, coastOnB: 1 }).balanceAtRet, 240000);
eq("family HSA follows the last partner to coast", CF.project({ ...H0, coastOnA: 1 }).balanceAtRet,
  100000 + 5 * 28000 + 5 * (6000 + 2000));
eq("family HSA after both coast uses the later partner's share",
  CF.project({ ...H0, coastOnA: 1, coastOnB: 1, coastAgeB: 47, afterB: 50 }).balanceAtRet,
  100000 + 5 * 28000 + 2 * (6000 + 2000) + 3 * (3000 + 1000));
// Same coast age, different shares: the larger share of the tied partners, whatever their order.
const TIE = { ...H0, coastOnA: 1, coastOnB: 1, afterA: 20, afterB: 60 };
eq("family HSA tie: both coast at 45, A keeps 20%, B 60% -> 60% of 2,000",
  CF.contribAt(TIE, CF.planOf(TIE), 45).hsa, 1200);
const TIE2 = { ...TIE, afterA: 60, afterB: 20 };
eq("family HSA tie: same answer with the partners swapped", CF.contribAt(TIE2, CF.planOf(TIE2), 45).hsa, 1200);
eq("self-only HSA: each half follows its partner", CF.project({ ...H0, hsaFamily: 0, coastOnA: 1 }).balanceAtRet,
  100000 + 5 * 28000 + 5 * (6000 + 1000));
check("coast switch off ignores the coast age", CF.project({ ...H0, coastAgeA: 41 }).balanceAtRet === 380000);
eq("coast age before today means coasting the whole way",
  CF.project({ ...H0, coastOnA: 1, coastOnB: 1, coastAgeA: 30, coastAgeB: 30 }).balanceAtRet, 100000);

// ---------- Barista draw ----------
// A coasts at 45 and the household draws 4,000/yr from 45 to 50: 5 x (8,000 - 4,000).
eq("barista draw from the first coast age", CF.project({ ...H0, coastOnA: 1, draw: 4000 }).balanceAtRet,
  100000 + 5 * 28000 + 5 * 4000);
// B stops at 46, A at 48: 6 full years, 2 years of A only (+HSA), then 2 years of nothing, draw 1,000 from 46.
eq("barista draw starts at the earlier of two coast ages",
  CF.project({ ...H0, coastOnA: 1, coastOnB: 1, coastAgeA: 48, coastAgeB: 46, draw: 1000 }).balanceAtRet,
  100000 + 6 * 28000 + 2 * (20000 + 2000 - 1000) + 2 * (-1000));
check("barista draw does nothing without a coast age", CF.project({ ...H0, draw: 4000 }).balanceAtRet === 380000);
check("balance never goes below 0",
  CF.project({ ...H0, assets: 0, coastOnA: 1, coastOnB: 1, coastAgeA: 40, coastAgeB: 40, draw: 50000 }).points.every((p) => p.balance >= 0));

// ---------- with growth: year-by-year vs closed form ----------
for (let t = 1; t <= 8; t++) {
  const inp = {
    ...TABLE, age: Math.round(between(22, 55)), assets: Math.round(between(0, 800000)),
    salA: Math.round(between(20000, 200000)), kA: Math.round(between(0, 24500)), empA: +between(0, 8).toFixed(1),
    rothA: Math.round(between(0, 7500)), salB: Math.round(between(20000, 200000)), kB: Math.round(between(0, 24500)),
    empB: +between(0, 8).toFixed(1), rothB: Math.round(between(0, 7500)), hsa: Math.round(between(0, 8750)),
    nominal: +between(2, 10).toFixed(1), inflation: +between(0, 5).toFixed(1),
  };
  inp.retAge = inp.age + 5 + Math.round(between(0, 30));
  inp.coastOnA = 1; inp.coastOnB = 1;
  const c = inp.age + Math.round(between(0, inp.retAge - inp.age));
  inp.coastAgeA = c; inp.coastAgeB = c;
  const p = CF.project(inp);
  const C = p.start.total, n = inp.retAge - inp.age, k = c - inp.age, r = p.r;
  const want = (inp.assets * Math.pow(1 + r, k) + C * CF.annuityFactor(r, k)) * Math.pow(1 + r, n - k);
  check(`random ${t}: loop = closed form with both coasting at ${c}`,
    Math.abs(p.balanceAtRet - want) <= Math.max(0.01, want * 1e-11), `${p.balanceAtRet} vs ${want}`);
  if (p.requiredAnnual > 0) {
    const hit = inp.assets * Math.pow(1 + r, n) + p.requiredAnnual * CF.annuityFactor(r, n);
    check(`random ${t}: required yearly total reaches the FIRE number`, near(hit, p.fire, Math.max(0.01, p.fire * 1e-9)));
  }
}

// ---------- earliest coast age solver ----------
// Spend 17,000 at 5% -> FIRE 340,000. Both stop at c: 100,000 + 28,000(c - 40) >= 340,000 -> c = 49.
// A alone: 100,000 + 10 x 8,000 + 20,000(c - 40) >= 340,000 -> c = 48.
// B alone: 100,000 + 10 x 22,000 + 6,000(c - 40) >= 340,000 -> c = 44 (3.33 years, rounded up).
const S1 = CF.project({ ...H0, spend: 17000 });
check("solver: both together at 49 (1 year coasting)", S1.earliest.both.age === 49 && S1.earliest.both.years === 1, J(S1.earliest.both));
check("solver: A alone at 48", S1.earliest.A.age === 48, J(S1.earliest.A));
check("solver: B alone at 44", S1.earliest.B.age === 44, J(S1.earliest.B));
// Holding the other's plan fixed: with B already stopping at 45, A alone needs
// 100,000 + 5 x 8,000 + 5 x 2,000 + 20,000(c - 40) >= 340,000 -> c = 50 (save to the end).
const S2 = CF.project({ ...H0, spend: 17000, coastOnB: 1, coastAgeB: 45 });
check("solver: A alone holds B's coast plan fixed", S2.earliest.A.age === 50 && S2.earliest.A.years === 0, J(S2.earliest.A));
check("solver: not possible returns null and the best case", T1.earliest.both.age === null && near(T1.earliest.both.best, 380000));
eq("solver: not possible needs 30,000 a year together", T1.requiredAnnual, 30000);
check("solver: retiring at 51 would work", T1.retireLater === 51, String(T1.retireLater));
eq("solver: spending you could afford = 380,000 x 5%", T1.spendWithin, 19000);
const S3 = CF.project({ ...H0, assets: 500000 });
check("solver: coasting now when assets beat the coast number", S3.reached && S3.earliest.both.age === 40 && S3.crossAge === 40);
check("solver: coasting now with nothing saved after says so (after = 0)", S3.earliest.both.after === 0);
// Keeping 50% after coasting: 13,000 + 1,000 HSA a year still goes in. With 200,000 invested,
// 200,000 + 10 x 14,000 = 340,000, so both can cut back today, but the money alone
// (200,000, under the 340,000 coast number) doesn't get there: the page must not say "no more saving".
const S5 = CF.project({ ...H0, spend: 17000, assets: 200000, afterA: 50, afterB: 50 });
check("solver: solved age = today while still saving the after-coasting share",
  S5.earliest.both.age === 40 && near(S5.earliest.both.after, 14000) && !S5.reached && S5.noContribAtRet < S5.fire, J(S5.earliest.both));
// Barista draw 15,000 from the common coast age c: c = 49 gives 352,000 - 15,000 = 337,000 < 340,000, so c = 50.
check("solver: Barista draw counted", CF.project({ ...H0, spend: 17000, draw: 15000 }).earliest.both.age === 50);
for (let t = 1; t <= 6; t++) {
  const inp = { ...TABLE, age: 30 + t * 3, assets: Math.round(between(20000, 600000)), spend: Math.round(between(30000, 90000)) };
  const p = CF.project(inp);
  const r = p.r, n = inp.retAge - inp.age, C = p.start.total;
  let want = null;
  for (let c = inp.age; c <= inp.retAge; c++) {
    const k = c - inp.age;
    const bal = (inp.assets * Math.pow(1 + r, k) + C * CF.annuityFactor(r, k)) * Math.pow(1 + r, n - k);
    if (bal >= p.fire * (1 - 1e-6)) { want = c; break; }
  }
  check(`solver ${t}: matches brute force (${want})`, p.earliest.both.age === want, `${p.earliest.both.age} vs ${want}`);
  // With 0% after coasting and no draw, the earliest both-coast age is where the projection meets the coast line.
  check(`solver ${t}: equals the coast-line crossing when nothing is saved after coasting`, p.earliest.both.age === p.crossAge);
}
// Saving 50% after coasting: the solver and the crossing can differ, so both are reported.
const S4 = CF.project({ ...H0, spend: 17000, afterA: 50, afterB: 50 });
check("solver: with saving after coasting the age comes earlier", S4.earliest.both.age < S1.earliest.both.age, J(S4.earliest.both));
check("sweep: later coast never lowers the balance", S1.sweep.every((s, i) => i === 0 || s.balance >= S1.sweep[i - 1].balance));
check("sweep: one point per whole age", S1.sweep.length === 11 && S1.sweep[0].age === 40);

// ---------- never coast: earliest retirement saving at full pace (SPEC 4.4) ----------
// H0 at 0% real: 100,000 + 28,000 a year; FIRE 400,000. Year-ends 380,000 at 50 and 408K at 51,
// so the line crosses at 50 + 20,000 / 28,000 = 50.714 (first whole age 51, same as "retire at 51").
const NC1 = CF.neverCoastAge(CF.sanitize(H0).values, 400000, 0);
eq("never coast: 0% real, crosses between year-ends at 50 + 20/28", NC1.age, 50 + 20000 / 28000, 1e-9);
check("never coast: first whole age 51, saving 28,000 a year", NC1.wholeAge === 51 && near(NC1.yearly, 28000), J([NC1.wholeAge, NC1.yearly]));
check("never coast: one point per whole age to 100", NC1.points.length === 61 && NC1.points[0].age === 40 &&
  NC1.points[10].balance === 380000 && NC1.points[60].age === 100);
const NC2 = CF.project({ ...H0, coastOnA: 1, coastOnB: 1, draw: 4000 });
check("never coast: ignores coast ages and the Barista draw", near(NC2.neverCoast.age, NC1.age, 1e-9) && NC2.neverCoast.wholeAge === 51,
  J(NC2.neverCoast.age));
check("never coast: project() matches retireLater (saving the whole way)", T1.neverCoast.wholeAge === T1.retireLater);
// Closed form with a constant real contribution: one person saving 10,000 a year from 0 at 5% real.
// B_k = 10,000 x ((1.05)^k - 1) / 0.05. FIRE = B_10 exactly -> age 50.0 (10 years from 40).
const ONE = CF.sanitize({ ...H0, two: 0, assets: 0, salA: 0, kA: 10000, empA: 0, rothA: 0, hsa: 0 }).values;
const F10 = 10000 * CF.annuityFactor(0.05, 10);
const NC3 = CF.neverCoastAge(ONE, F10, 0.05);
check("never coast: closed form, FIRE = B_10 is reached at exactly 50", near(NC3.age, 50, 1e-9) && NC3.wholeAge === 50, J([NC3.age, NC3.wholeAge]));
// FIRE where the continuous closed form crosses at 10.5 years: B_10 < FIRE < B_11, linear in between.
const F105 = 10000 * CF.annuityFactor(0.05, 10.5);
const NC4 = CF.neverCoastAge(ONE, F105, 0.05);
const B10 = 10000 * CF.annuityFactor(0.05, 10), B11 = 10000 * CF.annuityFactor(0.05, 11);
eq("never coast: closed form, interpolated between B_10 and B_11", NC4.age, 50 + (F105 - B10) / (B11 - B10), 1e-9);
check("never coast: closed form, near the continuous 50.5 and first whole age 51", Math.abs(NC4.age - 50.5) < 0.05 && NC4.wholeAge === 51);
check("never coast: closed form, every point matches B_k", NC4.points.slice(0, 30).every((p, k) => near(p.balance, 10000 * CF.annuityFactor(0.05, k), 1e-6)));
// Already past FIRE today: 500,000 invested against 400,000 -> now (age 40).
const NC5 = CF.neverCoastAge(CF.sanitize({ ...H0, assets: 500000 }).values, 400000, 0);
check("never coast: already at FIRE today -> the current age", NC5.age === 40 && NC5.wholeAge === 40, J([NC5.age, NC5.wholeAge]));
check("never coast: FIRE 0 -> today", CF.project({ ...H0, spend: 0 }).neverCoast.age === 40);
// Never: nothing saved and 0% real; or a negative real return whose balance levels off below FIRE
// (1,000 a year at -2.86% real tops out near 35K).
const NONE = { ...H0, salA: 0, kA: 0, empA: 0, rothA: 0, salB: 0, kB: 0, empB: 0, rothB: 0, hsa: 0 };
const NC6 = CF.neverCoastAge(CF.sanitize(NONE).values, 400000, 0);
check("never coast: never reaches -> null (not before 100)", NC6.age === null && NC6.wholeAge === null && NC6.points.length === 61);
const NC7 = CF.project({ ...NONE, assets: 0, hsa: 1000, nominal: 2, inflation: 5 });
check("never coast: negative real return levels off below FIRE -> null", NC7.neverCoast.age === null &&
  NC7.neverCoast.points[60].balance < 1000 / (1 - 1.02 / 1.05) + 1e-6);
// The search stops at 100: 28,000 a year from 0 reaches 400,000 after 14.3 years, so starting at 90 it's too late.
check("never coast: search capped at age 100", CF.neverCoastAge(CF.sanitize({ ...H0, age: 90, retAge: 95, assets: 0 }).values, 400000, 0).age === null &&
  CF.neverCoastAge(CF.sanitize({ ...H0, age: 80, retAge: 95, assets: 0 }).values, 400000, 0).wholeAge === 95);
check("never coast: interpolated age sits in the year before the first whole age", [0, 100000, 200000, 400000].every((a) => {
  const nc = CF.project({ ...H0, assets: a }).neverCoast;
  return nc.age !== null && nc.age <= nc.wholeAge && (nc.wholeAge === 40 || nc.age > nc.wholeAge - 1);
}));
// retireLater and the never-coast age come from one source, so they can't disagree past the cap:
// defaults at 75 retiring at 85 with nothing invested never reach FIRE by 100 (the old 30-year search said 110).
const OLD = CF.project({ age: 75, retAge: 85, assets: 0 });
check("never coast: age 75 / retAge 85 / nothing invested -> null, and retireLater null too (not 110)",
  OLD.earliest.both.age === null && OLD.neverCoast.wholeAge === null && OLD.retireLater === null && OLD.neverCoast.top === 100,
  J([OLD.neverCoast.wholeAge, OLD.retireLater]));
check("never coast: retireLater equals wholeAge whenever nothing works by retirement",
  [{}, { assets: 0 }, { age: 60, retAge: 70 }, { spend: 90000 }, { age: 75, retAge: 85, assets: 0 }, { retAge: 50 }].every((o) => {
    const P = CF.project(o);
    return P.earliest.both.age !== null || P.retireLater === P.neverCoast.wholeAge;
  }));
// Late crossing beyond the old retAge + 30 window: 0% real, 28,000 a year from 0 against 400,000 at age 40
// retiring at 41 -> crosses at 55 (14.3 years), well inside 100; retireLater follows it.
const LATE = CF.project({ ...H0, retAge: 41, assets: 0, nominal: 0, inflation: 0 });
check("never coast: retireLater follows the never-coast age", LATE.retireLater === LATE.neverCoast.wholeAge && LATE.retireLater === 55,
  J([LATE.retireLater, LATE.neverCoast.wholeAge]));
// The search covers the chosen horizon: retiring at 120 searches to 120; already 105 searches to 105 at least.
const NC120 = CF.neverCoastAge(CF.sanitize({ ...H0, age: 90, retAge: 120, assets: 0 }).values, 400000, 0);
check("never coast: search runs to retAge when it is past 100", NC120.top === 120 && NC120.points.length === 31 && NC120.wholeAge === 105,
  J([NC120.top, NC120.wholeAge]));
const NC105 = CF.neverCoastAge(CF.sanitize({ ...H0, age: 105, retAge: 104, assets: 0 }).values, 400000, 0);
check("never coast: already past 100 -> top is today's age", NC105.top === 105 && NC105.age === null && NC105.points.length === 1);
check("never coast: same as the plan's path when nobody coasts", T1.points.every((p, k) => near(p.balance, T1.neverCoast.points[k].balance)));

// The defaults (US medians) are the not-on-course state; the page designs for it.
const D = CF.project({});
check("defaults: not on course by 65 (shortfall state)", D.earliest.both.age === null && D.surplus < 0);
eq("defaults: FIRE number 71,000 / 4%", D.fire, 1775000);
eq("defaults: household saves 22,784/yr", D.start.total, 2 * (4800 + 62608 * 0.043 + 3200) + 1400, 1e-6);
check("defaults: never coasting, you could retire at 75 (same as retiring later)",
  D.neverCoast.wholeAge === 75 && D.retireLater === 75 && D.neverCoast.age > 74 && D.neverCoast.age <= 75, J(D.neverCoast.age));

// ---------- what-if grid ----------
const G = CF.grid(H0);
check("grid: 5 x 5, withdrawal 3.0-5.0% by 0.5", G.cells.length === 5 && G.cells.every((r) => r.length === 5) &&
  J(G.cols) === J([3, 3.5, 4, 4.5, 5]));
check("grid: returns +2 .. -2 around the input", J(G.rows) === J([5, 4, 3, 2, 1]));
check("grid: the input's cell matches the main result", G.cells[2][4].age === T1.earliest.both.age);
eq("grid: not-reachable cells give % of FIRE reached (380,000 / 400,000)", G.cells[2][4].pctOfFire, 0.95, 1e-9);
check("grid: a lower withdrawal rate never coasts earlier",
  CF.grid({ ...H0, spend: 10000 }).cells.every((row) => row.every((c, j) => j === 0 || c.age === null || row[j - 1].age === null || row[j - 1].age >= c.age)));

// ---------- 72(t) ----------
// $1,000,000 at 45, 5%, life expectancy 41.0: 50,000 / (1 - 1.05^-41) = 57,822.29.
eq("72(t): $1,000,000 at 45, 5%, factor 41.0", CF.sepPayment(1e6, 0.05, CF.lifeExpectancy(45)), 57822.29);
eq("72(t): 0% rate is balance / life expectancy", CF.sepPayment(410000, 0, 41.0), 10000);
check("72(t): runs the longer of 5 years or to 59½", CF.sepLockEnd(52) === 59.5 && CF.sepLockEnd(57) === 62);

// ---------- bridge timeline ----------
// No growth, no inflation. Retire at 52 with $1,000,000, all pre-tax; half in the 72(t) IRA.
// Payment: 500,000 x 5% / (1 - 1.05^-34.3) = 30,772.60/yr. Spending 40,000.
// 52-56: 9,227.40 a year beyond 72(t). Taxable 20,000, then basis 10,000, cover 30,000 of 46,137.02,
// so 55 is short 6,909.62 and 56 short 9,227.40 (16,137.02 in all). Ladder rungs converted at
// 52, 53, 54 ripen at 57, 58, 59 and cover those years (59 is half a year: 20,000 - 15,386.30).
const BR = {
  ...H0, age: 40, retAge: 52, assets: 1000000, nominal: 0, inflation: 0, spend: 40000, swr: 4,
  salA: 0, kA: 0, empA: 0, rothA: 0, salB: 0, kB: 0, empB: 0, rothB: 0, hsa: 0,
  preShare: 100, sepShare: 50, sepRate: 5, taxable: 20000, basis: 10000, lead: 0,
};
const B1 = CF.bridge(BR);
eq("bridge: 72(t) payment on 500,000 at 52", B1.pay0, 30772.60);
check("bridge: years 52 through 59 (half)", J(B1.years.map((y) => y.age)) === J([52, 53, 54, 55, 56, 57, 58, 59]) &&
  B1.years[7].frac === 0.5);
check("bridge: separate pots (72(t) 500,000, ladder 500,000)", near(B1.pot72, 500000) && near(B1.potLadder, 500000));
check("bridge: gap years 55 and 56", J(B1.gapYears) === J([55, 56]), J(B1.gapYears));
eq("bridge: gap at 55", B1.years[3].short, 9227.40 * 4 - 30000, 0.02);
eq("bridge: total gap", B1.totalShort, 16137.02);
check("bridge: taxable and basis are used before the ladder",
  near(B1.years[0].taxable, 9227.40) && near(B1.years[2].basis, 7682.21) && B1.years[0].basis === 0);
check("bridge: ladder rungs converted at 52-54, usable at 57-59",
  J(B1.conversions.map((c) => [c.age, c.usableAge])) === J([[52, 57], [53, 58], [54, 59]]));
check("bridge: the ladder covers 57-59", B1.years.slice(5).every((y) => y.short === 0) && near(B1.years[7].ladder, 20000 - 15386.30));
check("bridge: 72(t) is the same every year with no inflation", B1.years.slice(0, 7).every((y) => near(y.p72, 30772.60)));
const B2 = CF.bridge({ ...BR, lead: 2 });
check("bridge: converting 2 years before retiring closes the gap", B2.gapYears.length === 0 && B2.conversions[0].age === 50, J(B2.gapYears));
const B3 = CF.bridge({ ...BR, nominal: 2, inflation: 2 });
eq("bridge: 72(t) in today's dollars shrinks with inflation", B3.years[3].p72, B3.pay0 / Math.pow(1.02, 3));
check("bridge: a rung is converted bigger to beat 5 years of inflation",
  near(B3.conversions[0].amount, Math.max(0, 40000 - B3.years[5].p72) * Math.pow(1.02, 5)));
const B4 = CF.bridge({ ...BR, retAge: 57 });
check("bridge: retiring at 57 locks 72(t) to 62", B4.lockEnd === 62 && B4.warnings.includes("lockPast59"));
check("bridge: not shown at 59½ or later", CF.bridge({ ...BR, retAge: 60 }).applies === false && CF.bridge({ ...BR, retAge: 59 }).applies === true);
check("bridge: below the table's ages it says so", CF.bridge({ ...BR, age: 25, retAge: 29 }).reason === "tooYoung");
check("bridge: size-to-cover share", B1.shareToCover === Math.ceil(40000 / (2 * 30772.596212953795) * 100), String(B1.shareToCover));
check("bridge: 72(t) rate above 5% is flagged (Notice 2022-6 cap)",
  CF.bridge({ ...BR, sepRate: 12 }).warnings.includes("rateOverCap") && !B1.warnings.includes("rateOverCap") &&
  CF.bridge({ ...BR, sepRate: 5.1 }).warnings.includes("rateOverCap"));
check("bridge: warns when cash and basis exceed the non-pre-tax part", B1.warnings.includes("accessibleOverNonPreTax"));
eq("roth basis estimate: 5,000 x 10 years", CF.rothBasisEstimate(H0), 50000);

// ---------- edge cases ----------
const E1 = CF.project({ ...TABLE, age: 65, retAge: 60 });
check("retAge <= age: warns, zero years, one point", E1.warnings.includes("retAgeNotAfterAge") && E1.years === 0 && E1.points.length === 1);
eq("retAge <= age: coast number = FIRE number", E1.coastNow, E1.fire);
check("retAge <= age: no solver answer", E1.earliest.both.age === null && E1.requiredAnnual === null);
const N1 = CF.project({ ...H0, nominal: 2, inflation: 5 });
check("r < 0: warns, coast number above FIRE", N1.warnings.includes("negativeRealReturn") && N1.coastNow > N1.fire);
const S0 = CF.project({ ...TABLE, spend: 0 });
check("spend = 0: FIRE 0, reached, coasting now", S0.fire === 0 && S0.reached && S0.earliest.both.age === 42 && S0.warnings.includes("zeroSpend"));
check("swr 0 clamps to 0.1%", CF.sanitize({ swr: 0 }).values.swr === 0.1);
const blank = CF.sanitize({ swr: "", spend: "abc", age: "50" });
check("blank / non-numeric fields fall back and are marked invalid",
  blank.values.swr === 4 && blank.values.spend === 71000 && blank.values.age === 50 && blank.invalid.join() === "spend,swr", J(blank));
check("401(k) over the limit clamps to 24,500", CF.sanitize({ kA: 30000 }).values.kA === 24500);
check("Roth over the limit clamps to 7,500", CF.sanitize({ rothB: 9000 }).values.rothB === 7500);
check("HSA: family limit 8,750", CF.sanitize({ hsa: 8800 }).values.hsa === 8750 && CF.sanitize({ hsa: 8800 }).hsaClamped);
check("HSA: self-only, two people 8,800", CF.sanitize({ hsa: 8800, hsaFamily: 0 }).values.hsa === 8800);
check("HSA: self-only, one person 4,400", CF.sanitize({ hsa: 8000, hsaFamily: 0, two: 0 }).values.hsa === 4400);
check("switches store 0/1", CF.sanitize({ two: "yes" }).invalid.includes("two") && CF.sanitize({ two: 5 }).values.two === 1 &&
  CF.sanitize({ two: true }).values.two === 1);
check("negative money clamps to 0", CF.sanitize({ assets: -500 }).values.assets === 0 && CF.sanitize({ salA: -1 }).values.salA === 0);
check("fractional ages round", CF.sanitize({ age: 42.6 }).values.age === 43 && CF.sanitize({ coastAgeA: 54.4 }).values.coastAgeA === 54);
check("project() never sees invalid stored junk", Number.isFinite(CF.project({ age: "x", spend: null, swr: {} }).fire));
const H = CF.project({ ...TABLE, age: 0, retAge: 120, spend: 1e8, assets: 1e10, salA: 1e8, empA: 50, nominal: 30, inflation: -5, swr: 0.1 });
check("huge inputs: finite or flagged", [H.fire, H.coastNow, H.balanceAtRet].every(Number.isFinite) || H.warnings.includes("tooLarge"));
check("huge inputs: no NaN", !H.points.some((p) => Number.isNaN(p.balance)));
check("formatting: Infinity / NaN become 'Too large to show'", CF.fmtMoney(Infinity) === "Too large to show" && CF.fmtCompact(NaN) === "Too large to show");

// ---------- formatting ----------
check("money format", CF.fmtMoney(634890.93) === "$634,891" && CF.fmtMoney(0) === "$0" && CF.fmtMoney(-1127.51) === "-$1,128");
const compact = [[634890.93, "$635K"], [1525000, "$1.5M"], [999999, "$1M"], [999400, "$999K"], [1.2e12, "$1.2T"],
  [950, "$950"], [0, "$0"], [45000, "$45K"], [2.5e9, "$2.5B"], [100000, "$100K"]];
for (const [x, want] of compact) check(`compact ${x} -> ${want}`, CF.fmtCompact(x) === want, CF.fmtCompact(x));
check("compact with 2 digits for millions", CF.fmtCompact(1775000, 2) === "$1.78M" && CF.fmtCompact(1500000, 2) === "$1.5M" &&
  CF.fmtCompact(45000, 2) === "$45K", CF.fmtCompact(1775000, 2));

// ---------- typed numbers ----------
check("parse '61,000'", CF.parseNumber("61,000") === 61000);
check("parse '$1,500.50'", CF.parseNumber("$1,500.50") === 1500.5);
check("parse '7 %'", CF.parseNumber("7 %") === 7);
check("parse '' and 'abc' and '1.2.3' are NaN",
  Number.isNaN(CF.parseNumber("")) && Number.isNaN(CF.parseNumber("abc")) && Number.isNaN(CF.parseNumber("1.2.3")));

// ---------- shareable URL hash ----------
check("hash keys are unique", new Set(Object.values(CF.HASH_KEYS)).size === CF.KEYS.length);
check("hash round-trips every field", J(CF.decodeHash("#" + CF.encodeHash(H0))) === J(H0));
check("hash round-trips decimals", CF.decodeHash("#" + CF.encodeHash({ nominal: 7.25, inflation: 0.5 })).nominal === 7.25);
check("a v1 link still opens (its monthly key is ignored)",
  J(CF.decodeHash("#a=42&r=65&s=61000&b=45000&m=600&n=7&i=3&w=4")) ===
  J({ age: 42, retAge: 65, spend: 61000, assets: 45000, nominal: 7, inflation: 3, swr: 4 }));
check("hash accepts long names", CF.decodeHash("#coastAgeA=50&retAge=70").coastAgeA === 50);
const junk = CF.decodeHash("#a=abc&zz=5&r=999&=4&w&m=%E0%A4%A&s=1e5&ka=99999");
check("hash ignores junk and clamps", J(junk) === J({ retAge: 120, spend: 100000, kA: 24500 }), J(junk));
check("empty hash is empty", Object.keys(CF.decodeHash("")).length === 0 && Object.keys(CF.decodeHash("#")).length === 0);

// ---------- square-root money sliders ----------
const S = CF.SLIDER_STEPS;
for (const k of ["spend", "assets", "salA", "kA", "rothB", "hsa", "draw", "basis"]) {
  const f = CF.FIELDS[k];
  check(`${k} slider: ends map to the slider range`, CF.sliderToValue(k, 0) === f.sMin && CF.sliderToValue(k, S) === f.sMax);
  let mono = true, prev = -Infinity;
  for (let pos = 0; pos <= S; pos++) { const v = CF.sliderToValue(k, pos); if (v < prev) mono = false; prev = v; }
  check(`${k} slider: never decreases along the track`, mono);
  let rt = true;
  for (let t = 0; t < 40; t++) {
    const v = Math.round(between(f.sMin, f.sMax) / f.step) * f.step;
    const back = CF.sliderToValue(k, CF.valueToSlider(k, v));
    if (Math.abs(back - v) > Math.max(f.step, v * 0.05)) rt = false;
  }
  check(`${k} slider: value -> position -> value round-trips closely`, rt);
}
check("limit sliders end exactly on the limit", CF.sliderToValue("kA", S) === 24500 && CF.sliderToValue("rothA", S) === 7500 &&
  CF.sliderToValue("hsa", S) === 8750 && CF.sliderToValue("hsa", S, 4400) === 4400);
check("HSA slider follows the coverage limit", CF.valueToSlider("hsa", 4400, 4400) === S && CF.valueToSlider("hsa", 1100, 4400) === 500);
check("linear sliders are unchanged", CF.valueToSlider("age", 42) === 42 && CF.valueToSlider("age", 5) === 18 && CF.valueToSlider("nominal", 30) === 12);
check("nice rounding", CF.niceRound(1234567, 1000) === 1250000 && CF.niceRound(45200, 1000) === 45000 && CF.niceRound(0, 50) === 0);

// ---------- touch-safe sliders: gesture helpers (ui.js, SPEC 2.1) ----------
{
  const G = UI.classifyGesture;
  check("gesture: under 10px is still pending (a tap if it ends there)",
    G(0, 0) === "pending" && G(6, 7) === "pending" && G(-9, 0) === "pending" && UI.gestureEnd("pending") === "tap");
  check("gesture: mostly sideways is a drag", G(10, 0) === "horizontal" && G(-14, 9) === "horizontal" && G(30, -29) === "horizontal");
  check("gesture: mostly up/down is a scroll", G(0, 10) === "vertical" && G(4, -30) === "vertical" && G(9, 12) === "vertical");
  check("gesture: exactly diagonal scrolls (the page wins a tie)", G(20, 20) === "vertical" && G(-20, 20) === "vertical");
  check("gesture: drag and scroll keep their names when the finger lifts", UI.gestureEnd("horizontal") === "horizontal" && UI.gestureEnd("vertical") === "vertical");
  check("gesture: the slop can be changed", G(12, 0, 20) === "pending" && G(12, 0, 5) === "horizontal");

  // A 300px slider, 26px thumb: the thumb's center runs from 13 to 287.
  const T = UI.thumbCenter;
  check("thumb center: ends and middle stay inside the input",
    T(0, 0, 100, 300, 26) === 13 && T(100, 0, 100, 300, 26) === 287 && T(50, 0, 100, 300, 26) === 150);
  check("thumb center: values past the ends pin, an empty range sits at the start",
    T(-5, 0, 100, 300, 26) === 13 && T(150, 0, 100, 300, 26) === 287 && T(3, 3, 3, 300, 26) === 13);
  check("thumb center: offset ranges (ages 18..80)", near(T(65, 18, 80, 300, 26), 13 + 47 / 62 * 274, 1e-9));
  const N = UI.nearThumb;
  check("near thumb: within 24px of its center grabs it",
    N(150, 50, 0, 100, 300, 26) && N(174, 50, 0, 100, 300, 26) && N(126, 50, 0, 100, 300, 26) && N(0, 0, 0, 100, 300, 26));
  check("near thumb: a tap further along the track does not", !N(175, 50, 0, 100, 300, 26) && !N(20, 50, 0, 100, 300, 26) && !N(290, 0, 0, 100, 300, 26));
  check("near thumb: the grab area is at least 44px wide", UI.REACH * 2 >= 44 && N(150 + 22, 50, 0, 100, 300, 26) && N(150 - 22, 50, 0, 100, 300, 26));
  check("near thumb: the 8px overhang keeps 45px+ of grab at the ends (x from -8 past the input's left)",
    N(-8, 0, 0, 100, 300, 26) && N(37, 0, 0, 100, 300, 26) && N(308, 100, 0, 100, 300, 26) && N(263, 100, 0, 100, 300, 26));

  const F = UI.gestureFinish;
  const same = (o, c, r) => o.commit === c && o.revert === r;
  check("finish: a lifted finger after a drag commits only a changed value",
    same(F("horizontal", 65, 58, false), true, false) && same(F("horizontal", 65, 65, false), false, false));
  check("finish: a cancelled drag puts the value back and never commits",
    same(F("horizontal", 65, 85, true), false, true) && same(F("horizontal", 65, 65, true), false, false));
  check("finish: taps and scrolls do nothing, lifted or cancelled",
    same(F("pending", 65, 65, false), false, false) && same(F("vertical", 65, 65, true), false, false) && same(F("pending", 65, 70, true), false, false));

  const D = UI.dragValue;
  check("drag: no movement keeps the value (no jump to the finger)", D(50, 0, 0, 100, 1, 300, 26) === 50 && D(37, 0, 0, 100, 1, 300, 26) === 37);
  check("drag: moving the full travel goes end to end", D(0, 274, 0, 100, 1, 300, 26) === 100 && D(100, -274, 0, 100, 1, 300, 26) === 0);
  check("drag: relative to where the thumb was", D(50, 27.4, 0, 100, 1, 300, 26) === 60 && D(65, -7 * 274 / 62, 18, 80, 1, 300, 26) === 58 && D(65, -5, 18, 80, 1, 300, 26) === 64);
  check("drag: clamped at the ends", D(90, 500, 0, 100, 1, 300, 26) === 100 && D(10, -500, 0, 100, 1, 300, 26) === 0);
  check("drag: snaps to the step without float dust", D(4, 13.7, 0, 12, 0.1, 300, 26) === 4.6 && D(0, 1, 1, 10, 0.5, 300, 26) === 1);
  check("drag: a zero step or a narrow input does not break it", D(5, 3, 0, 10, 0, 300, 26) === 5 && Number.isFinite(D(5, 3, 0, 10, 1, 10, 26)));
}

// ---------- collapsed sections: saved state and summary lines (ui.js) ----------
{
  const P = (raw) => J(UI.parseOpen(raw));
  check("open state: missing, broken or non-object JSON reads as empty",
    P(null) === "{}" && P("") === "{}" && P("{oops") === "{}" && P("[true]") === "{}" && P("7") === "{}");
  check("open state: keeps id-like keys with true/false only",
    P(J({ "d-kpis": true, assume: false, "bad key": true, x: "yes", "2x": true, "d-heat": 1 })) === J({ "d-kpis": true, assume: false }));
  const m0 = { a: true };
  const m1 = UI.withOpen(m0, "d-ec", 1);
  check("open state: withOpen returns a new map and leaves the old one alone", J(m0) === J({ a: true }) && m1["d-ec"] === true && m1.a === true);
  check("open state: a saved choice beats the default, the default fills gaps",
    UI.isOpenIn({ x: false }, "x", true) === false && UI.isOpenIn({}, "x", true) === true && UI.isOpenIn({}, "y") === false);
  check("open state: its storage key is separate from the numbers", UI.UI_KEY !== "coastfire.v2" && UI.UI_KEY === "coastfire.ui.v1");

  const d = CF.project({});
  const kr = (x) => CF.fmtCompact(Math.round(x / 1000) * 1000);
  check("spoken() reads the tilde as about", UI.spoken("save ~$20K") === "save about $20K" && UI.nudgeLine === undefined);
  check("numbers row (defaults): FIRE, coast today, shortfall at 65",
    UI.kpiSummary(d) === `FIRE $1.78M · coast today ${CF.fmtCompact(d.coastNow, 2)} · ${CF.fmtCompact(-d.surplus, 2)} short at 65`, UI.kpiSummary(d));
  const rich = CF.project({ assets: 500000 });
  check("numbers row says ahead when the plan has a surplus", rich.surplus > 0 && UI.kpiSummary(rich).endsWith(" ahead at 65"), UI.kpiSummary(rich));
  check("numbers row with bad ages asks to fix them", UI.kpiSummary(CF.project({ age: 60, retAge: 60 })) === "fix the ages first");
  check("contributions row (defaults): $22,784/yr and the monthly figure",
    UI.contribSummary(d) === `$22,784/yr · ${CF.fmtMoney(d.start.total / 12)}/mo`, UI.contribSummary(d));
  check("earliest coast row (defaults): not possible by 65", UI.ecSummary(d) === "not possible by 65");
  const E = rich.earliest, ageW = (e) => (e.age <= rich.inputs.age ? "now" : String(e.age));
  check("earliest coast row: both, then each partner alone",
    UI.ecSummary(rich) === `both ${ageW(E.both)} · A alone ${ageW(E.A)} · B alone ${ageW(E.B)}`, UI.ecSummary(rich));
  const solo = CF.project({ assets: 500000, two: 0 });
  check("earliest coast row, one person: just the age", UI.ecSummary(solo) === String(solo.earliest.both.age), UI.ecSummary(solo));
  check("partner row, no coast plan: accounts, then no coast",
    UI.partnerSummary(d.inputs, "A") === "401(k) $4,800 · employer 4.3% · Roth $3,200 · no coast", UI.partnerSummary(d.inputs, "A"));
  const coasting = CF.sanitize({ ...CF.DEFAULTS, coastOnB: 1, afterB: 30 }).values;
  check("partner row, coast plan on: it leads the line",
    UI.partnerSummary(coasting, "B") === `coasts at 55, then ${CF.fmtMoney(CF.partnerBase(coasting, "B").total * 0.3)}/yr · 401(k) $4,800 · employer 4.3% · Roth $3,200`, UI.partnerSummary(coasting, "B"));
  check("partner row: the after-coast amount is 30% of 401(k) + employer + Roth",
    Math.abs(UI.afterCoast(coasting, "B") - (4800 + 62608 * 0.043 + 3200) * 0.3) < 1e-6 && UI.afterCoast(coasting, "A") === 0);
  const stopAll = CF.sanitize({ ...CF.DEFAULTS, coastOnA: 1 }).values;
  check("partner row, coasting with nothing kept: no amount", UI.partnerSummary(stopAll, "A").startsWith("coasts at 55 · 401(k)"), UI.partnerSummary(stopAll, "A"));
  const gd = CF.grid(CF.DEFAULTS), gOk = gd.cells.flat().filter((c) => c.age !== null).length;
  check("returns grid row: how many of the 25 cases make it",
    UI.heatSummary(d, gd) === (gOk === 0 ? "none make it by 65" : gOk === 25 ? "all 25 make it" : `${gOk} of 25 make it`), UI.heatSummary(d, gd));
  const gRich = CF.grid({ ...CF.DEFAULTS, assets: 2000000 });
  check("returns grid row: every case works", UI.heatSummary(CF.project({ ...CF.DEFAULTS, assets: 2000000 }), gRich) === "all 25 make it");
  check("returns grid row with bad ages asks to fix them", UI.heatSummary(CF.project({ age: 60, retAge: 60 }), CF.grid({ age: 60, retAge: 60 })) === "fix the ages first");
  const late = CF.sanitize({ ...CF.DEFAULTS, coastOnA: 1, coastAgeA: 70 }).values;
  check("partner row, coast age at or after retirement: no effect", UI.partnerSummary(late, "A").startsWith("coast age 70, no effect"));
  check("HSA row", UI.hsaSummary(d.inputs) === "Family · $1,400/yr" && UI.hsaSummary({ hsaFamily: 0, hsa: 1000 }) === "Self-only · $1,000/yr");
  check("Barista draw row: none by default", UI.drawSummary(d) === "none");
  const drawing = CF.project({ draw: 20000, coastOnA: 1, coastOnB: 1, coastAgeA: 50, coastAgeB: 50 });
  check("Barista draw row: amount and the first coast age", UI.drawSummary(drawing) === `${CF.fmtCompact(20000)}/yr from 50`, UI.drawSummary(drawing));
  check("Barista draw row: needs a coast age when none is set", UI.drawSummary(CF.project({ draw: 20000 })) === `${CF.fmtCompact(20000)}/yr · needs a coast age`);
  check("returns row: 7.0% · inflation 2.4% · withdraw 4.0%", UI.assumeSummary(d.inputs).text === "7.0% · inflation 2.4% · withdraw 4.0%");
  const v55 = { ...CF.DEFAULTS, retAge: 55 }, r55 = CF.project(v55), b55 = CF.bridge(v55, r55);
  const bs = UI.bridgeSummary(r55, b55);
  check("bridge row before 59½: chip, value and teaser",
    bs.title === "Early-access bridge" && bs.value === "5 short years" && bs.chip.kind === "bad" &&
    bs.teaser === `72(t) pays ${kr(b55.pay0)} in year one; short ${CF.fmtCompact(b55.totalShort, 2)} over 5 years.`, J(bs));
  const b65 = UI.bridgeSummary(d, CF.bridge(CF.DEFAULTS, d));
  check("bridge row at 65: one invitation, no chip or teaser", b65.title === "Retiring before 59½?" && b65.chip === null && b65.teaser === "", J(b65));
}

// ---------- buying a home: rent vs buy (SPEC 11) ----------
{
  // Mortgage payment and balance.
  eq("mortgage: 300,000 at 6% for 30 years -> 1,798.65/mo", CF.mortgagePayment(300000, 0.06, 30), 1798.65);
  eq("mortgage: 300,000 at 0% for 30 years -> 833.33/mo", CF.mortgagePayment(300000, 0, 30), 833.33);
  eq("mortgage: 300,000 at 6% for 15 years -> 2,531.57/mo", CF.mortgagePayment(300000, 0.06, 15), 2531.57);
  check("mortgage: no loan, no payment", CF.mortgagePayment(0, 0.06, 30) === 0 && CF.loanBalance(0, 0.06, 30, 12) === 0);
  // Balance: the closed form against paying it month by month.
  let bal = 300000;
  const pmt6 = CF.mortgagePayment(300000, 0.06, 30);
  for (let t = 1; t <= 120; t++) bal = bal * 1.005 - pmt6;
  eq("mortgage balance after 10 years = month-by-month schedule", CF.loanBalance(300000, 0.06, 30, 120), bal, 1e-6);
  check("mortgage balance: full before the first payment, 0 when paid off",
    CF.loanBalance(300000, 0.06, 30, 0) === 300000 && CF.loanBalance(300000, 0.06, 30, 360) === 0 && CF.loanBalance(300000, 0.06, 30, 400) === 0);
  eq("mortgage balance at 0%: falls in a straight line (300,000 - 120 x 833.33)", CF.loanBalance(300000, 0, 30, 120), 200000, 1e-6);

  // Hand-added base (H0 at 0% real, 0% inflation): 100,000 invested, 28,000/yr, ages 40 -> 50.
  const HB = { ...H0, nominal: 0, inflation: 0, houseOn: 1, buyAge: 42, price: 120000, downPct: 20, downFrom: 1,
    mortRate: 0, term: 15, pmi: 0, closePct: 0, sellPct: 0, propTax: 0, insure: 0, maint: 0, apprec: 0,
    rent: 96000 / 180, rentGrowth: 0 };
  // Loan 96,000 over 15 years at 0%: 533.33/mo, the same as the rent, so owning costs exactly what renting does.
  const Z = CF.house(HB);
  check("zero case: applies, buying at 42, 24,000 down", Z.applies && Z.b === 42 && near(Z.cash, 24000) && near(Z.loan, 96000), J([Z.applies, Z.b, Z.cash]));
  eq("zero case: payment 96,000 / 180 months", Z.payment, 96000 / 180, 1e-9);
  check("zero case: owning costs what renting does every year", Z.points.every((p) => Math.abs(p.delta) < 1e-6));
  check("zero case: buying path = renting path minus the cash at closing from 42",
    Z.points.every((p) => near(p.post !== undefined ? p.post : p.balance, T1.points[p.age - 40].balance - (p.age >= 42 ? 24000 : 0))));
  eq("zero case: portfolio at 50 = 380,000 - 24,000", Z.atRet.buyPortfolio, 356000);
  // Equity = down payment + principal paid: 24,000 + 96 payments x 533.33 = 24,000 + 51,200.
  eq("zero case: equity at 50 = down + principal paid", Z.points[10].equity, 24000 + 51200, 1e-6);
  eq("zero case: loan left at 50 = 96,000 - 51,200", Z.atRet.loanLeft, 44800, 1e-6);
  eq("zero case: net worth buying = 356,000 + 120,000 - 44,800 (no selling costs)", Z.atRet.buyNW, 431200, 1e-6);
  eq("zero case: net worth renting = the plan's 380,000", Z.atRet.rentNW, 380000, 1e-6);
  eq("zero case: selling costs come off the home's value in net worth only",
    CF.house({ ...HB, sellPct: 6 }).atRet.buyNW, 356000 + 120000 * 0.94 - 44800, 1e-6);
  check("zero case: selling costs leave the portfolio alone", near(CF.house({ ...HB, sellPct: 6 }).atRet.buyPortfolio, 356000));

  // Real P&I falls with inflation: a fixed payment in dollars of the purchase year.
  const INF = CF.house({ ...HB, nominal: 2, inflation: 2, mortRate: 5 });
  const iy = (a) => INF.points[a - 40];
  const T5 = CF.homeTerms(CF.sanitize({ ...HB, nominal: 2, inflation: 2, mortRate: 5 }).values, 0);
  eq("real P&I: 3 years after buying = first year / 1.02^3", T5.ownAt(45).pi, T5.ownAt(42).pi / Math.pow(1.02, 3), 1e-6);
  eq("real P&I: first year = 12 x the payment", T5.ownAt(42).pi, 12 * CF.mortgagePayment(96000, 0.05, 15), 1e-6);
  check("real P&I: 0 once the 15-year loan is paid", T5.ownAt(57).pi === 0 && T5.ownAt(56).pi > 0);
  eq("real loan balance: the scheduled balance deflated", iy(45).loan, CF.loanBalance(96000, 0.05, 15, 36) / Math.pow(1.02, 3), 1e-6);

  // PMI: 100,000 with 10% down, 0% for 30 years: 90,000 falls 3,000 a year, so it reaches 78,000 (78%) after 4 years.
  const PM = { ...HB, price: 100000, downPct: 10, term: 30, pmi: 0.5 };
  const TP = CF.homeTerms(CF.sanitize(PM).values, 0);
  check("PMI: 0.5% of 90,000 = 450/yr for the 4 years above 78% of the price",
    [42, 43, 44, 45].every((a) => near(TP.ownAt(a).pmi, 450)) && TP.ownAt(46).pmi === 0 && TP.ownAt(47).pmi === 0,
    J([42, 43, 44, 45, 46].map((a) => TP.ownAt(a).pmi)));
  // 10.5% down: the loan falls by 1/360 a month and crosses 78% of the price after 46.3 months, so the
  // year starting at 45 (months 36-47) has 11 months of PMI, pro-rated; none from 46.
  const PM2 = { ...PM, downPct: 10.5 }, TP2 = CF.homeTerms(CF.sanitize(PM2).values, 0);
  check("PMI: pro-rated in the year it ends (11 of 12 months)", TP2.pmiMonths(3) === 11 && TP2.pmiMonths(2) === 12 && TP2.pmiMonths(4) === 0 &&
    near(TP2.ownAt(45).pmi, 0.005 * TP2.L * 11 / 12, 1e-9) && near(TP2.ownAt(44).pmi, 0.005 * TP2.L, 1e-9) && CF.house(PM2).pmiEnds === 46,
    J([44, 45, 46].map((a) => TP2.ownAt(a).pmi)));
  check("PMI: ends at 46 (balance 78,000 = 78%)", CF.house(PM).pmiEnds === 46, String(CF.house(PM).pmiEnds));
  check("PMI: none with 20% down", CF.homeTerms(CF.sanitize({ ...PM, downPct: 20 }).values, 0).ownAt(42).pmi === 0 && CF.house({ ...PM, downPct: 20 }).pmiEnds === null);
  check("PMI: none on a cash purchase", CF.house({ ...PM, downPct: 100 }).payment === 0 && CF.house({ ...PM, downPct: 100 }).pmiEnds === null);

  // Cash flow into saving. A cash purchase (50,000, no loan) at 45 with 30,000/yr of insurance and no rent:
  // owning costs 30,000 more than renting, above the 28,000 saved, so saving stops and 2,000/yr is short.
  const CFX = { ...HB, buyAge: 45, price: 50000, downPct: 100, insure: 30000, rent: 0 };
  const X1 = CF.house(CFX);
  check("cash flow: owning above the saving floors contributions at 0", X1.points.slice(5, 10).every((p) => p.contrib === 0 && near(p.deficit, 2000)));
  check("cash flow: 5 years short, 10,000 in all, 5 years owning costs more",
    X1.yearsShort === 5 && near(X1.totalDeficit, 10000) && X1.yearsCostMore === 5 && X1.warnings.includes("deficit"), J([X1.yearsShort, X1.totalDeficit]));
  eq("cash flow: portfolio 100,000 + 5 x 28,000 - 50,000 (the deficit isn't taken from it)", X1.atRet.buyPortfolio, 190000);
  // Both coast at 45 (nothing saved after), rent 1,000/mo vs owning 2,000/yr: the 10,000 saved goes in anyway.
  const X2 = CF.house({ ...CFX, insure: 2000, rent: 1000, coastOnA: 1, coastOnB: 1 });
  check("cash flow: owning cheaper adds the saving to contributions, even while coasting", X2.points.slice(5, 10).every((p) => near(p.contrib, 10000)));
  eq("cash flow: 100,000 + 5 x 28,000 - 50,000 + 5 x 10,000", X2.atRet.buyPortfolio, 240000);
  check("cash flow: no years costing more when owning is cheaper", X2.yearsCostMore === 0 && X2.yearsShort === 0);

  // Retirement spending includes today's rent. A paid-off home: rent 500/mo replaced by
  // 1% tax + 1% upkeep on 100,000 + 1,000 insurance = 3,000 a year.
  const FO = { ...HB, buyAge: 45, price: 100000, downPct: 100, rent: 500, propTax: 1, maint: 1, insure: 1000 };
  const F1 = CF.house(FO);
  eq("owner's FIRE number, paid off: (20,000 - 6,000 + 3,000) / 5%", F1.fire.own, 340000, 1e-6);
  eq("renter's FIRE number with no rent growth = the main FIRE number", F1.fire.rent, 400000, 1e-6);
  // With 10 of 15 years of a 0% mortgage still to pay at 50: 80,000 / 15 = 5,333.33 a year, 10 more years.
  const F2 = CF.house({ ...FO, downPct: 20, term: 15 });
  eq("owner's FIRE number with years left adds the payments still due", F2.fire.own, 340000 + 10 * 80000 / 15, 1e-6);
  eq("owner's FIRE number: mortgage left at R = 53,333.33", F2.fire.mortLeft, 80000 / 15 * 10, 1e-6);
  // At a real return the remaining payments are discounted: check against the sum written out.
  const T7 = CF.homeTerms(CF.sanitize({ ...FO, downPct: 20, term: 15, nominal: 6, inflation: 2 }).values, 1.06 / 1.02 - 1);
  let pv = 0;
  for (let j = 5; j < 15; j++) pv += 12 * T7.pmt / Math.pow(1.02, j) / Math.pow(1.06 / 1.02, j - 5 + 1);
  eq("owner's FIRE number: remaining payments discounted at the real return", T7.mortLeft(50), pv, 1e-6);
  const RG = CF.house({ ...FO, rentGrowth: 1 });
  eq("renter's FIRE number moves with rent growth", RG.fire.rent, (20000 + 6000 * Math.pow(1.01, 10) - 6000) / 0.05, 1e-6);

  // FI, coast-line and earliest-coast ages, buying vs renting. A 24,000 cash purchase at 42 with
  // nothing changing each year; FIRE 340,000 both ways (spend 17,000 at 5%, no rent).
  const AG = { ...HB, spend: 17000, price: 24000, downPct: 100, rent: 0 };
  const A1 = CF.house(AG), A1r = CF.project(AG);
  eq("FI age renting = the never-coast age (48 + 16/28)", A1.fi.rent.age, A1r.neverCoast.age, 1e-9);
  eq("FI age renting: 48.57", A1.fi.rent.age, 48 + 16000 / 28000, 1e-9);
  // Buying: 76,000 + 28,000 x (a - 40) reaches 340,000 at 49 + 12/28.
  eq("FI age buying: 49 + 12/28", A1.fi.buy.age, 49 + 12000 / 28000, 1e-9);
  check("FI age buying: first whole age 50", A1.fi.buy.wholeAge === 50);
  check("earliest coast: renting 49 (= the main solver), buying 50",
    A1.earliest.rent.age === 49 && A1r.earliest.both.age === 49 && A1.earliest.buy.age === 50, J(A1.earliest));
  check("meets the coast line: renting 49 (= the main crossing), buying 50",
    A1.cross.rent === A1r.crossAge && A1.cross.rent === 49 && A1.cross.buy === 50, J(A1.cross));
  check("earliest coast buying, not possible: best is the balance saving the whole way",
    CF.house({ ...AG, spend: 20000 }).earliest.buy.age === null && near(CF.house({ ...AG, spend: 20000 }).earliest.buy.best, 356000));

  // The defaults (SPEC 11.9), switched on.
  const DH = CF.project({ houseOn: 1 }), HD = CF.house({ houseOn: 1 }, DH);
  eq("defaults: cash at closing 41,800 down + 12,540 closing", HD.cash, 54340, 1e-6);
  eq("defaults: owning about 3,588/mo at first", HD.first.total, 3588, 0.5);
  eq("defaults: rent 1,530/mo", HD.first.rent, 1530, 1e-9);
  eq("defaults: P&I 2,604.73/mo on 376,200 at 7.4%", HD.first.pi, 2604.73, 0.01);
  check("defaults: 20 years owning costs more, from 45 to 64", HD.yearsCostMore === 20);
  eq("defaults: portfolio at 65 buying about 297,000", HD.atRet.buyPortfolio, 297433, 1);
  eq("defaults: portfolio at 65 renting = the plan's 1,009,932", HD.atRet.rentPortfolio, 1009932, 1);
  eq("defaults: net worth at 65 buying about 594,000", HD.atRet.buyNW, 594411, 1);
  eq("defaults: owner's FIRE number about 1.72M", HD.fire.own, 1715273, 1);
  check("defaults: FI renting 74.3 (= never coast), buying 87.9",
    near(HD.fi.rent.age, DH.neverCoast.age, 1e-9) && near(HD.fi.buy.age, 87.88, 0.01) && HD.fi.buy.wholeAge === 88, J(HD.fi));
  check("defaults: breakevens about 4.5% growth and 2.2% rate",
    near(HD.breakeven.growth.value, 4.53, 0.01) && near(HD.breakeven.rate.value, 2.22, 0.01), J(HD.breakeven));
  // Breakevens tie net worth at R.
  const atG = CF.house({ houseOn: 1, apprec: HD.breakeven.growth.value });
  const atI = CF.house({ houseOn: 1, mortRate: HD.breakeven.rate.value });
  check("breakeven growth: net worth ties within a dollar", Math.abs(atG.atRet.buyNW - atG.atRet.rentNW) < 1, String(atG.atRet.buyNW - atG.atRet.rentNW));
  check("breakeven rate: net worth ties within a dollar", Math.abs(atI.atRet.buyNW - atI.atRet.rentNW) < 1, String(atI.atRet.buyNW - atI.atRet.rentNW));
  // No sign change: a cheap cash home against high rent is ahead at any growth and any rate;
  // buying a year before retiring with nothing rented loses to renting at any growth up to 10%.
  const AH = CF.house({ ...HB, price: 50000, downPct: 100, rent: 3000 });
  check("breakeven: buying ahead even at -10%/yr and at any rate", AH.breakeven.growth.side === "buy" && AH.breakeven.growth.value === null &&
    AH.breakeven.rate.side === "buy", J(AH.breakeven));
  const BH = CF.house({ ...HB, buyAge: 49, rent: 0, closePct: 6, sellPct: 10 });
  check("breakeven: renting stays ahead up to 10%/yr", BH.breakeven.growth.side === "rent" && BH.breakeven.growth.value === null, J(BH.breakeven));

  // Switched off: every existing result is unchanged.
  const strip = (p) => { const { inputs, ...rest } = p; return J(rest); };
  for (const o of [{}, H0, { ...H0, coastOnA: 1, draw: 4000 }, { retAge: 55 }, { age: 60, retAge: 60 }]) {
    const on = { ...o, houseOn: 1, buyAge: 30, price: 900000 };
    check(`off or on, project() is the same (${J(o).slice(0, 30)})`, strip(CF.project(o)) === strip(CF.project(on)));
    check(`off or on, the grid and the bridge are the same (${J(o).slice(0, 30)})`,
      J(CF.grid(o)) === J(CF.grid(on)) && J(CF.bridge(o)) === J(CF.bridge(on)));
  }
  check("off by default: house() does nothing", CF.house({}).applies === false && CF.house({}).reason === "off" && CF.DEFAULTS.houseOn === 0);

  // Edge cases (SPEC 11.6).
  const NOW = CF.house({ ...HB, buyAge: 30 });
  check("buy age at or before today: bought at the current age", NOW.b === 40 && NOW.warnings.includes("buyNow") && near(NOW.points[0].post, 76000));
  check("buy age at or after retirement: not modeled", CF.house({ ...HB, buyAge: 50 }).reason === "buyAfterRet" && CF.house({ ...HB, buyAge: 60 }).applies === false);
  check("bad ages: not modeled", CF.house({ ...HB, age: 50, retAge: 50 }).reason === "badAges");
  check("price 0: not modeled", CF.house({ ...HB, price: 0 }).reason === "noPrice");
  check("down payment below 3% clamps to 3% (no 100% loan)", CF.sanitize({ downPct: 0 }).values.downPct === 3 && CF.sanitize({ downPct: 1 }).values.downPct === 3);
  check("term: 15 stays, anything else is 30", CF.sanitize({ term: 15 }).values.term === 15 && CF.sanitize({ term: 20 }).values.term === 30 &&
    CF.sanitize({ term: "abc" }).values.term === 30);
  const NEG = CF.house({ ...HB, nominal: 1, inflation: -1, mortRate: 4 });
  check("negative inflation: real P&I rises, results finite", NEG.points[5].own > NEG.points[2].own && Number.isFinite(NEG.atRet.buyNW));
  const LEFT = CF.house({ ...HB, term: 30 });
  check("loan running past R: balance left and payments in the owner's FIRE number", LEFT.atRet.loanLeft > 0 && LEFT.fire.mortLeft > 0 &&
    near(LEFT.atRet.loanLeft, 96000 - 96000 / 360 * 96, 1e-6));
  // Cash short: buying today with 10,000 invested and 24,000 needed.
  const SH = CF.house({ ...HB, buyAge: 40, assets: 10000 });
  check("cash short at closing: 14,000 short, path floors at 0", near(SH.cashShort, 14000) && SH.points[0].post === 0 && SH.warnings.includes("cashShort"));
  check("cash short: the 14,000 gap is a debt in buying net worth and the breakevens, not a gift",
    near(SH.atRet.shortDebt, 14000, 1e-6) && near(SH.atRet.buyNW, SH.atRet.buyPortfolio + SH.atRet.homeNet - 14000, 1e-6), J(SH.atRet));
  // Renting plan: 10,000 + 28,000 a year has 38,000 at 41, so 41 is the first age with 24,000 on hand.
  check("cash short: the renting plan would have enough at 41", SH.afford === 41, String(SH.afford));
  check("separate cash fund: the portfolio is untouched and the renter is credited the cash",
    near(CF.house({ ...HB, downFrom: 0 }).atRet.buyPortfolio, 380000) && near(CF.house({ ...HB, downFrom: 0 }).atRet.rentNW, 380000 + 24000) &&
    CF.house({ ...HB, downFrom: 0 }).cashShort === 0);
  // FI before the purchase doesn't count if closing drops the portfolio below the owner's FIRE number:
  // defaults, 400,000 invested, retire at 66, buy at 64. Renting reaches FI near 63; the balance just
  // after closing at 64 is below FIRE_own(64), so buying is FI only after that, from the post-closing gap.
  const LB = { houseOn: 1, assets: 400000, retAge: 66, buyAge: 64 }, LBh = CF.house(LB);
  const LBt = CF.homeTerms(CF.sanitize(LB).values, CF.project(LB).r), LBp = LBh.points.find((p) => p.age === 64);
  check("FI buying: must stay FI through the purchase (FI near 63 renting, after 64 buying)",
    near(LBh.fi.rent.age, 63, 0.01) && LBp.post < LBt.fireOwn(64) && LBh.fi.buy.age > 64 && LBh.fi.buy.wholeAge >= 65 &&
    UI.houseSummary(CF.project(LB), LBh) !== "Buy at 64: same FI age", J(LBh.fi));
  // Already FI before the purchase and still FI after closing: the earlier age stands.
  const LB2 = { ...LB, assets: 1000000 }, LB2h = CF.house(LB2);
  // (Before the purchase both paths and both targets are the same, so the FI ages match.)
  check("FI buying: an FI age before the purchase stands when closing keeps it", LB2h.fi.buy.age !== null && LB2h.fi.buy.age < 64 &&
    near(LB2h.fi.buy.age, LB2h.fi.rent.age, 1e-9), J(LB2h.fi));
  const HUGE = CF.house({ ...HB, price: 1e9, rent: 1e6, nominal: 30, inflation: -5 });
  check("huge numbers: no NaN", HUGE.points.every((p) => !Number.isNaN(p.balance)) && !Number.isNaN(HUGE.atRet.buyNW));

  // Hash: the sixteen new keys round-trip; an old link opens with the house off.
  const HK = ["houseOn", "buyAge", "price", "downPct", "downFrom", "mortRate", "term", "pmi", "closePct", "sellPct", "propTax",
    "insure", "maint", "apprec", "rent", "rentGrowth"];
  check("hash: sixteen new keys, all with short names", HK.every((k) => CF.KEYS.includes(k) && CF.HASH_KEYS[k]) && CF.KEYS.length === 50);
  const HV = { ...CF.DEFAULTS, houseOn: 1, buyAge: 50, price: 650000, downPct: 25, downFrom: 0, mortRate: 6.85, term: 15, pmi: 0.4,
    closePct: 2.5, sellPct: 5.5, propTax: 1.25, insure: 2400, maint: 1.5, apprec: -0.5, rent: 2650, rentGrowth: 0.3 };
  check("hash round-trips the house fields", J(CF.decodeHash("#" + CF.encodeHash(HV))) === J(HV));
  check("an old link opens with the house off", CF.sanitize({ ...CF.DEFAULTS, ...CF.decodeHash("#a=42&r=65") }).values.houseOn === 0);

  // Summary lines (ui.js).
  const sum = (o) => { const p = CF.project(o); return UI.houseSummary(p, CF.house(o, p)); };
  check("house row: off", sum({}) === "off");
  check("house row: bad ages", sum({ houseOn: 1, age: 60, retAge: 60 }) === "fix the ages first");
  check("house row: buy age after retirement", sum({ houseOn: 1, buyAge: 70 }) === "buy before 65 to compare");
  check("house row: no price", sum({ houseOn: 1, price: 0 }) === "add a home price");
  check("house row: cash short", sum({ ...HB, buyAge: 40, assets: 10000 }) === "Buy at 40: $14K short at closing", sum({ ...HB, buyAge: 40, assets: 10000 }));
  check("house row (defaults): FI 13.6 yrs later", sum({ houseOn: 1 }) === "Buy at 45: FI 13.6 yrs later", sum({ houseOn: 1 }));
  check("house row: FI earlier", sum({ ...AG, rent: 500 }).startsWith("Buy at 42: FI ") && sum({ ...AG, rent: 500 }).endsWith(" earlier"), sum({ ...AG, rent: 500 }));
  check("house row: same FI age", sum({ ...AG, price: 100, rent: 0 }) === "Buy at 42: same FI age", sum({ ...AG, price: 100 }));
  check("house row: net worth when an FI age isn't found", sum({ ...HB, spend: 1e6 }) === `Buy at 42: ${CF.fmtCompact(431200 - 380000, 2)} more at 50`, sum({ ...HB, spend: 1e6 }));
  check("costs row", UI.houseCostsSummary(CF.DEFAULTS) === "closing 3% · selling 6% · tax 0.9% · insurance $1,600 · upkeep 1% · growth 0.5%", UI.houseCostsSummary(CF.DEFAULTS));
  check("breakeven row (defaults)", UI.breakevenSummary(HD) === "ties at home prices +4.5%/yr or a 2.2% rate", UI.breakevenSummary(HD));
  check("how row (defaults): payment and every year", UI.houseHowSummary(HD, 65) === `P&I ${CF.fmtMoney(HD.first.pi)}/mo · owning costs more every year`, UI.houseHowSummary(HD, 65));
  check("how row: cash purchase, some years", UI.houseHowSummary({ ...HD, payment: 0, yearsCostMore: 3 }, 65) === "owning costs more 3 of 20 yrs");
  check("breakeven row: ahead either way", UI.breakevenSummary(AH) === "buying ahead at any growth · buying ahead at any rate", UI.breakevenSummary(AH));
}

// ---------- suggestions: ways to reach a goal (SPEC 12) ----------
{
  const SG = (o) => CF.suggest(o);
  const by = (sg, id, who) => sg.list.concat(sg.rejected).find((s) => s.id === id && (who === undefined || s.who === who));
  const ctxOf = (sg) => ({ scenario: sg.scenario });
  const tolOf = (sg) => (sg.goal.type === "early" ? 0 : 1e-6 * Math.max(1, sg.progress.need));
  // Whether a patch meets the suggestion's goal (sanitized first, as the page does), judged as Apply would leave it.
  const meetsAfter = (sg, set, G) => {
    const v2 = CF.sanitize({ ...sg.inputs, ...set }).values;
    return CF.margin(v2, G || CF.goalOf(v2), ctxOf(sg)) >= -tolOf(sg);
  };
  const meetsG = (sg, set, G) => CF.margin(CF.sanitize({ ...sg.inputs, ...set }).values, G || sg.goal, ctxOf(sg)) >= -tolOf(sg);

  // Inputs: three new fields, cleaned, hashed and reset like every other.
  check("goal inputs: defaults goal 0, goalAge 55, taxSave 0, short hash names go / gx / o",
    CF.DEFAULTS.goal === 0 && CF.DEFAULTS.goalAge === 55 && CF.DEFAULTS.taxSave === 0 &&
    CF.HASH_KEYS.goal === "go" && CF.HASH_KEYS.goalAge === "gx" && CF.HASH_KEYS.taxSave === "o");
  const GV = { ...CF.DEFAULTS, goal: 3, goalAge: 61, taxSave: 2500 };
  check("goal inputs: hash round-trips go, gx and o", J(CF.decodeHash("#" + CF.encodeHash(GV))) === J(GV) &&
    J(CF.decodeHash("#go=2&gx=50&o=1200")) === J({ goal: 2, goalAge: 50, taxSave: 1200 }));
  check("goal choice: 2 stays 2, 7 and junk clean to 0", CF.sanitize({ goal: 2 }).values.goal === 2 &&
    CF.sanitize({ goal: 7 }).values.goal === 0 && CF.sanitize({ goal: "x" }).values.goal === 0 && CF.decodeHash("#go=9").goal === 0);
  check("term choice unchanged: 15 stays, 30 stays, junk is 30", CF.sanitize({ term: 15 }).values.term === 15 &&
    CF.sanitize({ term: 30 }).values.term === 30 && CF.sanitize({ term: 7 }).values.term === 30);
  check("reset clears the new inputs (the defaults have them at 0 / 55 / 0)",
    J(CF.sanitize({}).values).includes('"goal":0,"goalAge":55,"taxSave":0'));
  // Taxable saving: 2,000 a year split 1,000 / 1,000; A coasts at 45 keeping nothing, so A's half stops.
  eq("taxable saving adds to the projection: 380,000 + 10 x 2,000", CF.project({ ...H0, taxSave: 2000 }).balanceAtRet, 400000);
  eq("taxable saving follows each partner's coast plan (A's half stops at 45)",
    CF.project({ ...H0, taxSave: 2000, coastOnA: 1 }).balanceAtRet, 280000 + 10 * 1000 + 5 * 1000);
  eq("taxable saving, one person: all of it follows A", CF.project({ ...H0, two: 0, taxSave: 2000, coastOnA: 1, afterA: 50 }).balanceAtRet,
    100000 + 5 * 24000 + 5 * (10000 + 1000 + 1000));
  check("taxable saving: a component of contributions", near(CF.contribAt(CF.sanitize({ ...H0, taxSave: 2000 }).values,
    CF.planOf(CF.sanitize(H0).values), 40).taxable, 2000));

  // The goal.
  const g = (o) => CF.goalOf(CF.sanitize(o).values);
  check("goal 0: retire by R when nobody coasts", J(g(H0)) === J({ type: "retire", X: null, T: null, inferred: true }));
  check("goal 0: coast by X when every partner coasts at the same age", g({ ...H0, coastOnA: 1, coastOnB: 1 }).type === "coast" &&
    g({ ...H0, coastOnA: 1, coastOnB: 1 }).X === 45 && g({ ...H0, coastOnA: 1, coastOnB: 1 }).inferred);
  check("goal 0: different coast ages judge the plan as entered (retire)", g({ ...H0, coastOnA: 1 }).type === "retire" &&
    g({ ...H0, coastOnA: 1, coastOnB: 1, coastAgeB: 47 }).type === "retire");
  check("goal 2: coast by X, clamped to today; X at R becomes retire (xIsR)",
    g({ ...H0, goal: 2, goalAge: 44 }).X === 44 && g({ ...H0, goal: 2, goalAge: 30 }).X === 40 &&
    g({ ...H0, goal: 2, goalAge: 50 }).type === "retire" && g({ ...H0, goal: 2, goalAge: 60 }).coerced === "xIsR");
  check("goal 3: FI by T", g({ ...H0, goal: 3, goalAge: 48 }).type === "early" && g({ ...H0, goal: 3, goalAge: 48 }).T === 48);

  // Search helpers.
  check("bisect up: the smallest multiple of the step that passes, from a low guess", CF.bisect((x) => x >= 1234, 100, 200, { step: 100, cap: 1e6 }) === 1300 &&
    CF.bisect((x) => x >= 5e7, 100, 100, { step: 100, cap: 1e6 }) === null);
  check("bisect down: the largest that passes", CF.bisect((x) => x <= 19050, 0, 70900, { step: 100, dir: "down" }) === 19000 &&
    CF.bisect((x) => x < 0, 0, 500, { step: 100, dir: "down" }) === null);
  check("scanAge: first pass going up, last of a run going down", CF.scanAge((a) => a >= 51, 41, 100) === 51 &&
    CF.scanAge((a) => a >= 48, 49, 41, "last") === 48 && CF.scanAge(() => false, 41, 60) === null);

  // allocate / unallocate: the waterfall (HSA, Roth IRAs, 401(k)s, taxable), even splits, limits respected.
  const HV0 = CF.sanitize(H0).values;
  const A12 = CF.allocate(HV0, 12000);
  // HSA 2,000 -> 8,750 (+6,750); 5,250 left for Roth: B gets 2,600, A 2,650 > A's room 2,500, so A 2,500 and B 2,750.
  check("allocate 12,000: HSA to 8,750, then Roth A to 7,500 and Roth B to 2,750",
    J(A12.set) === J({ hsa: 8750, rothA: 7500, rothB: 2750 }) && A12.left === 0, J(A12.set));
  const A40 = CF.allocate(HV0, 40000);
  // 6,750 HSA + 2,500 + 7,500 Roth = 16,750; 23,250 to 401(k)s. A's pay room: 100,000 - 20,000 - 2,500 = 77,500;
  // B's: 50,000 - 6,000 - 7,500 = 36,500. Even split: B 11,600, A 11,650 (room 14,500 and 19,500).
  check("allocate 40,000: then 401(k)s split evenly (A 21,650, B 16,600)", J(A40.set) === J({ hsa: 8750, rothA: 7500, rothB: 7500, kA: 21650, kB: 16600 }), J(A40.set));
  const AHuge = CF.allocate(HV0, 200000);
  check("allocate: a huge amount ends in taxable, every field within its limit",
    AHuge.set.taxSave > 0 && AHuge.set.kA === 24500 && AHuge.set.kB === 24500 && AHuge.set.rothA === 7500 &&
    AHuge.set.hsa === 8750 && Object.keys(AHuge.set).every((k) => AHuge.set[k] <= CF.FIELDS[k].max), J(AHuge.set));
  check("allocate never changes employer money", Object.keys(AHuge.set).every((k) => !k.startsWith("emp")));
  check("allocate, one person: never touches B", Object.keys(CF.allocate(CF.sanitize({ ...H0, two: 0 }).values, 50000).set).every((k) => !k.endsWith("B")));
  check("allocate, self-only HSA with two people: up to 8,800 (4,400 each)",
    CF.allocate(CF.sanitize({ ...H0, hsaFamily: 0 }).values, 7000).set.hsa === 8800);
  check("allocate skips an HSA not in use, and Roth for a partner with no salary",
    CF.allocate(CF.sanitize({ ...H0, hsa: 0, salB: 0 }).values, 1000).set.rothA === 6000 &&
    CF.allocate(CF.sanitize({ ...H0, hsa: 0, salB: 0 }).values, 1000).set.hsa === undefined);
  check("allocate: a partner's room stops at their own salary (B 10,000 pay, 6,000 saved -> Roth +4,000)",
    CF.allocate(CF.sanitize({ ...H0, hsa: 0, salB: 10000, kB: 5000, empB: 10, rothA: 7500 }).values, 6000).set.rothB === 4000);
  const U8 = CF.unallocate(HV0, 8000);
  check("unallocate 8,000: 401(k)s first (no taxable), evenly: kA 6,000, kB 1,000", J(U8.set) === J({ kA: 6000, kB: 1000 }), J(U8.set));

  // Retire by 50, FIRE 400,000 (SPEC 9 fixture: 380,000 at 50).
  const R4 = SG(H0);
  const sv = by(R4, "save"), sp = by(R4, "spend"), rl = by(R4, "retLater");
  check("retire 400,000: short by 20,000", R4.status === "short" && near(R4.margin, -20000));
  check("retire 400,000: save 2,000 more, all to the HSA (2,000 -> 4,000), one part",
    sv.change.delta === 2000 && J(sv.set) === J({ hsa: 4000 }) && sv.parts === 1 && sv.feasible, J(sv.set));
  check("retire 400,000: save is minimal (1,900 more falls short)", meetsG(R4, sv.set) && !meetsG(R4, CF.allocate(R4.inputs, 1900).set));
  check("retire 400,000: spend 19,000 (= 380,000 x 5%), and 19,100 falls short",
    sp.change.to === 19000 && meetsG(R4, { spend: 19000 }) && !meetsG(R4, { spend: 19100 }));
  check("retire 400,000: retire at 51, the same as project().retireLater", rl.change.to === 51 && T1.retireLater === 51);
  check("retire 400,000: ranked by effort (save 2,000 / 150,000 pay first)", R4.best.id === "save" && near(sv.effort, 2000 / 150000, 1e-12) &&
    R4.list.every((s, i) => i === 0 || s.kind === "combo" || s.effort >= R4.list[i - 1].effort - 1e-12));

  // FIRE 500,000: the waterfall written out above.
  const R5 = SG({ ...H0, spend: 25000 });
  check("retire 500,000: save 12,000 more through the waterfall", by(R5, "save").change.delta === 12000 &&
    J(by(R5, "save").set) === J({ hsa: 8750, rothA: 7500, rothB: 2750 }), J(by(R5, "save").set));
  check("retire 500,000: flags the limits reached and the Roth income note",
    by(R5, "save").flags.filter((f) => f.code === "atLimit").map((f) => f.key).join() === "hsa,rothA" &&
    by(R5, "save").flags.some((f) => f.code === "rothIncome") && by(R5, "save").flags.some((f) => f.code === "hsaEligibility"));

  // Coast by 45, FIRE 340,000: both coasting at 45 reach 240,000; extra saving counts only before 45.
  const C45 = SG({ ...H0, spend: 17000, goal: 2, goalAge: 45 });
  check("coast by 45: 240,000 of 340,000", C45.status === "short" && near(C45.progress.have, 240000) && near(C45.progress.need, 340000));
  check("coast by 45: save 100,000 / 5 years = 20,000 more", by(C45, "save").change.delta === 20000 && meetsG(C45, by(C45, "save").set) &&
    !meetsG(C45, CF.allocate(C45.inputs, 19900).set));
  check("coast by 45: the save patch also turns both coast switches on at 45",
    by(C45, "save").set.coastOnA === 1 && by(C45, "save").set.coastAgeA === 45 && by(C45, "save").set.coastOnB === 1 && by(C45, "save").set.coastAgeB === 45 &&
    by(C45, "save").parts === 5);
  check("coast by 45: keep saving to 49 together (= earliestCoast both)", by(C45, "coastBoth").change.to === 49 && S1.earliest.both.age === 49 &&
    by(C45, "coastBoth").set.goalAge === 49);
  check("coast by 45: A alone to 50 with B held at 45 (SPEC 4.4), switching the goal to retire",
    by(C45, "coastA").change.to === 50 && S2.earliest.A.age === 50 && by(C45, "coastA").set.goal === 1 && by(C45, "coastA").set.coastAgeB === 45);
  check("coast by 45: only the better single-partner lever is listed", C45.list.filter((s) => s.id === "coastA" || s.id === "coastB").length <= 1);
  const C40 = SG({ ...H0, spend: 17000, goal: 2, goalAge: 40 });
  check("coast at today's age: saving more has no years (noYearsLeft); spend (5,000, under the $10K floor) and retiring later are still solved",
    by(C40, "save").feasible === false && by(C40, "save").reason === "noYearsLeft" &&
    !by(C40, "spend").feasible && by(C40, "spend").reason === "belowFloor" && by(C40, "spend").change.to === 5000 && by(C40, "retLater") !== undefined);

  // Barista draw: A coasts at 45 drawing 4,000. Balances: 260,000 with the draw, 280,000 without.
  // FIRE 270,000 (13,500 at 5%): 280,000 - 5 x D >= 270,000 -> D <= 2,000.
  const DR = SG({ ...H0, spend: 13500, coastOnA: 1, draw: 4000 });
  check("draw: drawLess solved to 2,000 and minimal (2,500 falls short)", by(DR, "drawLess").change.to === 2000 &&
    meetsG(DR, { draw: 2000 }) && !meetsG(DR, { draw: 2500 }));
  check("draw: no draw lever without a coast age", by(SG({ ...H0, draw: 4000 }), "drawLess") === undefined);

  // On track, FIRE 300,000: the opportunities, each the largest change that still meets it.
  const OT = SG({ ...H0, spend: 15000 });
  const op = (id, who) => OT.list.find((s) => s.id === id && (who === undefined || s.who === who));
  check("on track: status met, opportunities only", OT.status === "met" && OT.list.every((s) => s.kind === "opportunity"));
  check("on track: spend up to 19,000, and 19,100 fails", op("spendMore").change.to === 19000 && meetsG(OT, { spend: 19000 }) && !meetsG(OT, { spend: 19100 }));
  check("on track: save 8,000 less (401(k)s first, employer untouched), and 8,100 fails",
    op("saveLess").change.delta === -8000 && J(op("saveLess").set) === J({ kA: 6000, kB: 1000 }) && !meetsG(OT, CF.unallocate(OT.inputs, 8100).set));
  check("on track: retire at 48, and 47 fails", op("retireSooner").change.to === 48 && !meetsG(OT, { retAge: 47 }));
  check("on track: coast sooner together = earliestCoast (48)",
    op("coastSooner", "both").change.to === 48 && CF.earliestCoast(OT.inputs, "both", 300000, 0).age === 48);
  check("on track: ranked by benefit, largest first", OT.list.every((s, i) => i === 0 || s.benefit <= OT.list[i - 1].benefit));

  // FI by a target age.
  const E49 = SG({ ...H0, goal: 3, goalAge: 49 });
  const es = by(E49, "save");
  check("early: FI at 51 now, the goal is 49", E49.status === "short" && E49.progress.fiAge === 51 && E49.margin === -2);
  check("early: save makes the FI age 49, and 100 less does not",
    CF.neverCoastAge(CF.sanitize({ ...H0, ...es.set }).values, 400000, 0).wholeAge <= 49 &&
    CF.neverCoastAge(CF.sanitize({ ...H0, ...CF.allocate(E49.inputs, es.change.delta - 100).set }).values, 400000, 0).wholeAge > 49);
  check("early: no retire-later or coast levers", !by(E49, "retLater") && !by(E49, "coastBoth"));
  const EFI = SG({ ...H0, assets: 500000, goal: 3, goalAge: 45 });
  check("early: already FI today -> fiNow, empty list", EFI.status === "fiNow" && EFI.list.length === 0);
  const ENV = SG({ ...NONE, goal: 3, goalAge: 60 });
  check("early: never FI -> the levers still aim at the goal age (spend 5,000 is under the floor, so not offered)", ENV.status === "short" && ENV.progress.fiAge === null &&
    by(ENV, "spend").reason === "belowFloor" && CF.neverCoastAge(CF.sanitize({ ...NONE, spend: by(ENV, "spend").change.to }).values,
      by(ENV, "spend").change.to / 0.05, 0).wholeAge <= 60);

  // Bad ages.
  check("bad ages: badAges and nothing else", SG({ age: 60, retAge: 60 }).status === "badAges" && SG({ age: 60, retAge: 60 }).list.length === 0);

  // The defaults (SPEC 8): $1.01M of $1.78M at 65.
  const DS = SG({});
  const dsave = by(DS, "save");
  check("defaults: save 19,700 more = ceil to $100 of 42,452 - 22,784", dsave.change.delta === 19700 &&
    dsave.change.delta === Math.ceil((D.requiredAnnual - D.start.total) / 100) * 100);
  check("defaults: the split is HSA +7,350, Roth +4,300 each, 401(k) +1,900 / +1,850",
    J(dsave.set) === J({ hsa: 8750, rothA: 7500, rothB: 7500, kA: 6700, kB: 6650 }), J(dsave.set));
  check("defaults: spend 40,300 and retire at 75 (= the never-coast tile)", by(DS, "spend").change.to === 40300 &&
    by(DS, "retLater").change.to === 75 && D.neverCoast.wholeAge === 75);
  check("defaults: needs about 7.0% withdrawal or an 11.1% return (information only)",
    near(DS.sensitivity.needSwr, 7.03, 0.01) && near(DS.sensitivity.needReturn, 11.1, 0.1), J(DS.sensitivity));
  check("defaults: the margin at the needed return is within $1 of zero",
    Math.abs(CF.margin(CF.sanitize({ nominal: DS.sensitivity.needReturn }).values, DS.goal, { scenario: "rent" })) <= 1);
  check("defaults: needed withdrawal rate = spend / balance", near(DS.sensitivity.needSwr, 71000 / DS.progress.have * 100, 1e-9));

  // Ranking and the combo.
  check("ranking: at most 6, every card (the combo too) sorted by effort",
    DS.list.length <= 6 && DS.list.every((s, i, a) => i === 0 || s.effort >= a[i - 1].effort - 1e-12));
  const combo = DS.list.find((s) => s.kind === "combo");
  check("ranking: a combo that scores lower than every single step comes first and is the best (defaults: 0.118 against 0.157)",
    DS.list[0] === combo && DS.best === combo && near(combo.effort, 0.118, 0.001) && near(dsave.effort, 0.157, 0.001));
  // Combo labels: both parts' flags, once each; the partial save's own limits (Roth stops at 6,950 / 6,900, under 7,500).
  const cflags = combo.flags.map((f) => f.code + (f.key ? ":" + f.key : ""));
  check("combo: carries the partial save's labels (HSA, Roth income, match), no duplicates",
    ["hsaEligibility", "rothIncome", "matchNote"].every((c) => cflags.includes(c)) && new Set(cflags).size === cflags.length, cflags.join());
  check("combo: the first part's limits come from its own steps (Roth A 6,950 is not at the limit; the HSA is)",
    combo.pair[0].steps.find((x) => x.key === "rothA").to === 6950 &&
    !combo.pair[0].flags.some((f) => f.code === "atLimit" && f.key === "rothA") && combo.pair[0].flags.some((f) => f.code === "atLimit" && f.key === "hsa"));
  check("combo: offered when the best single step is above 0.15, scores below it, and its merged patch meets the goal",
    dsave.effort > CF.COMBO_TAU && combo && combo.effort < dsave.effort && combo.pair.length === 2 && meetsG(DS, combo.set, combo.goal2));
  check("combo: none when a small single step exists", !R4.list.some((s) => s.kind === "combo"));

  // Buying a home: house levers only when it is on; the buying plan is judged.
  check("house off: no house levers", !DS.list.concat(DS.rejected).some((s) => ["price", "buyLater", "down", "noBuy"].includes(s.id)) && DS.scenario === "rent");
  const HB2 = { ...H0, spend: 17000, houseOn: 1, buyAge: 42, price: 100000, downPct: 20, mortRate: 0, term: 15, pmi: 0, closePct: 0,
    sellPct: 0, propTax: 0, insure: 0, maint: 0, apprec: 0, rent: 0, rentGrowth: 0 };
  const HS = SG(HB2);
  check("house on: the buying plan is judged against the owner's FIRE number", HS.scenario === "buy" && HS.buyAge === 42 &&
    near(HS.progress.need, CF.house(HB2).fire.own) && near(HS.progress.have, CF.house(HB2).atRet.buyPortfolio) && HS.status === "short");
  // Typical home figures (SPEC 11.9) with 300,000 invested and 50,000/yr spending: buying at 45 is short.
  const HS3 = SG({ houseOn: 1, assets: 300000, spend: 50000 });
  const hp = by(HS3, "price"), hb = by(HS3, "buyLater"), hd = by(HS3, "down");
  check("house on: a cheaper home meets it and is minimal ($1,000 more does not)", HS3.status === "short" && hp.feasible &&
    meetsG(HS3, hp.set) && !meetsG(HS3, { price: hp.change.to + 1000 }), J(hp.change));
  check("house on: buying later meets it and a year earlier does not", hb.feasible && meetsG(HS3, hb.set) && !meetsG(HS3, { buyAge: hb.change.to - 1 }), J(hb.change));
  check("house on: a bigger down payment is scanned (meets it, or no amount does)", hd.feasible ? meetsG(HS3, hd.set) : hd.reason === "noEffect");
  const nb = by(HS, "noBuy");
  check("house on: renting instead shows the renting plan's margin", near(nb.rentMargin, CF.margin(CF.sanitize({ ...HB2, houseOn: 0 }).values, HS.goal, { scenario: "rent" })));
  check("house on: renting instead is never ranked first while another step works", HS.list[0].id !== "noBuy");

  // Global invariant: every Apply patch, sanitized, comes back unclamped and meets the goal it was solved for.
  let allOk = true, bad = "";
  for (const o of [{}, H0, { ...H0, spend: 25000 }, { ...H0, spend: 17000, goal: 2, goalAge: 45 }, { ...H0, spend: 13500, coastOnA: 1, draw: 4000 },
    { ...H0, spend: 15000 }, { ...H0, goal: 3, goalAge: 49 }, { houseOn: 1 }, HB2, { two: 0 }, { goal: 2, goalAge: 50 }, { assets: 500000 }]) {
    const sg = SG(o);
    for (const s of sg.list) {
      if (!s.set) continue;
      const v2 = CF.sanitize({ ...sg.inputs, ...s.set }).values;
      const clamped = Object.keys(s.set).some((k) => v2[k] !== s.set[k]);
      const okG = CF.margin(v2, s.goal2 || sg.goal, s.id === "noBuy" ? { scenario: "rent" } : ctxOf(sg)) >= -tolOf(sg);
      const okAfter = s.kind === "opportunity" || s.id === "noBuy" || meetsAfter(sg, s.set);
      if (clamped || !okG || !okAfter) { allOk = false; bad += `${J(o).slice(0, 40)} ${s.id} ${clamped ? "clamped" : ""} ${okG ? "" : "misses"} ${okAfter ? "" : "missesAfterApply"}; `; }
    }
  }
  check("every Apply patch is unclamped and meets its goal (and the goal as Apply leaves it)", allOk, bad);

  // Buying now with little invested: the cash short at closing is a debt (as house() counts it), never free.
  const SHORT_IN = { houseOn: 1, buyAge: 42, assets: 20000, spend: 75000, kA: 15000, kB: 15000, rothA: 7000, rothB: 7000 };
  const SH = SG(SHORT_IN), SHh = CF.house(SHORT_IN);
  check("cash short at closing: the buying plan's balance has the shortfall taken off as a debt grown to R",
    SHh.cashShort > 0 && near(SH.progress.have, SHh.atRet.buyPortfolio - SHh.atRet.shortDebt, 1), `${SH.progress.have} vs ${SHh.atRet.buyPortfolio - SHh.atRet.shortDebt}`);
  check("cash short at closing: no feasible card puts more down", !SH.list.some((s) => s.id === "down" && s.feasible));
  check("cash short at closing: the margin at 49% down carries its bigger shortfall",
    CF.margin(CF.sanitize({ ...SHORT_IN, downPct: 49 }).values, SH.goal, { scenario: "buy" }) < 0 &&
    CF.measure(CF.sanitize({ ...SHORT_IN, downPct: 49 }).values, SH.goal, { scenario: "buy" }).cashShort > SHh.cashShort);
  const DN = SG({ houseOn: 1, assets: 200000, buyAge: 42, spend: 30000, downPct: 5 });
  check("a down payment the portfolio can't cover at closing is 'Not on its own' (cashShort)",
    by(DN, "down").feasible === false && by(DN, "down").reason === "cashShort" && by(DN, "down").cashShort > 0 &&
    UI.rejectedText(DN).includes("a bigger down payment (more cash at closing than the portfolio holds"), UI.rejectedText(DN));
  const DOK = SG({ houseOn: 1, assets: 200000, buyAge: 43, spend: 30000, downPct: 5 });
  check("a down payment the portfolio covers is still offered, its effort spread over the years to R",
    by(DOK, "down").feasible && near(by(DOK, "down").effort, 418000 * (by(DOK, "down").change.to - 5) / 100 / (23 * 2 * 62608), 1e-9));

  // Coast goal: every card's Apply patch turns both coast switches on at X, so the page judges that same plan.
  for (const [name, sg] of [["coast by 50", SG({ goal: 2, goalAge: 50, assets: 150000 })], ["coast by 45", C45]]) {
    const cards = sg.list.filter((s) => s.set);
    // X, or for a one-partner coast card that partner's own later age (the other held at X).
    const X = (s, p) => { const g2 = s.goal2 || sg.goal; return g2.ages && g2.ages[p] !== undefined ? g2.ages[p] : g2.X !== null ? g2.X : sg.goal.X; };
    check(`${name}: every card's patch sets coastOnA/B = 1 at its X`, cards.length > 0 && cards.every((s) =>
      s.set.coastOnA === 1 && s.set.coastOnB === 1 && s.set.coastAgeA === X(s, "A") && s.set.coastAgeB === X(s, "B")), cards.map((s) => s.id + J(s.set)).join("; "));
    check(`${name}: after Apply, the plan as entered (retire by R, the hero's figure) meets it too`, cards.every((s) =>
      CF.margin(CF.sanitize({ ...sg.inputs, ...s.set }).values, { type: "retire" }, ctxOf(sg)) >= -tolOf(sg)),
      cards.map((s) => s.id + " " + Math.round(CF.margin(CF.sanitize({ ...sg.inputs, ...s.set }).values, { type: "retire" }, ctxOf(sg)))).join("; "));
  }
  check("coast goal: the spend card says it also sets the coast switches", UI.cardText(by(SG({ goal: 2, goalAge: 50, assets: 150000 }), "spend"),
    SG({ goal: 2, goalAge: 50, assets: 150000 })).note === "Also sets both of you to coast at 50.");

  // Impossible or implausible: never a card for retiring on almost nothing, after 80, or for a near-free home.
  const IMP = SG({ age: 70, retAge: 72, assets: 0, salA: 0, salB: 0, spend: 200000 });
  check("impossible goal: no feasible card at all, spending less is 'Not on its own' (below the floor)",
    IMP.status === "short" && IMP.list.every((s) => s.kind === "combo") && !IMP.list.some((s) => s.set && s.set.spend !== undefined && s.set.spend < 10000) &&
    by(IMP, "spend").reason === "belowFloor" && UI.suggestSummary(IMP) === "No single step gets there", J(IMP.list.map((s) => s.id)));
  const LOWPAY = SG({ two: 0, salA: 30000, kA: 1000, spend: 60000, assets: 0 });
  check("low pay: spending $10,700 and retiring at 97 are not cards (floor 25% of $60,000; after 80)",
    by(LOWPAY, "spend").reason === "belowFloor" && by(LOWPAY, "retLater").reason === "tooLate" && by(LOWPAY, "retLater").change.to === 97 &&
    UI.rejectedText(LOWPAY).includes("retiring later (would take until 97)") && LOWPAY.list.every((s) => s.feasible && (s.set.spend === undefined || s.set.spend >= 15000)));
  const HON = SG({ houseOn: 1 });
  check("house on: a home at about 11% of the price and retiring at 88 are not cards, nor in the hero line",
    by(HON, "price").reason === "belowFloor" && by(HON, "retLater").reason === "tooLate" &&
    !HON.list.some((s) => s.id === "price" || s.id === "retLater") && !UI.suggestLine(HON).includes("88"), UI.suggestLine(HON));
  let floorOk = true;
  for (const o of [{}, { houseOn: 1 }, { goal: 2, goalAge: 55 }, { two: 0, salA: 30000, spend: 60000, assets: 0 }, { houseOn: 1, goal: 2, goalAge: 55 }]) {
    const sg = SG(o);
    for (const s of sg.list) {
      const parts = s.pair || [s];
      for (const q of parts) {
        if (q.id === "spend" && q.change.to < Math.max(10000, 0.25 * sg.inputs.spend)) floorOk = false;
        if (q.id === "retLater" && q.change.to > 80) floorOk = false;
        if (q.id === "price" && q.change.to < 0.25 * sg.inputs.price) floorOk = false;
      }
    }
  }
  check("no card (or combo part) spends below the floor, retires after 80 or buys under 25% of the price", floorOk);

  // Words.
  const RICH = SG({ assets: 600000 });
  check("on track: the withdrawal rate reads 'as low as' (a lower rate is the cautious one), never 'up to'",
    UI.sensitivityText(RICH).includes("with a withdrawal rate as low as ") && !UI.sensitivityText(RICH).includes("up to"), UI.sensitivityText(RICH));
  check("on track: coasting at today's age reads 'could stop saving now'",
    RICH.list.filter((s) => s.id === "coastSooner" && s.change.to === 42).every((s) => UI.cardText(s, RICH).title === `${s.who} could stop saving now`) &&
    RICH.list.some((s) => s.id === "coastSooner" && s.change.to === 42));
  check("on track: the status names the target once ('more than the ... you need')", UI.statusText(RICH).includes("more than the $1.78M you need"), UI.statusText(RICH));
  check("house on: the status and the hero line name the buying scenario and its own gap",
    UI.statusText(HON).startsWith("With the home purchase at 45, your plan reaches ") &&
    /^If you buy at 45, you'd be \$[\d.]+[KM] short\. Closest steps: /.test(UI.suggestLine(HON)) &&
    UI.statusText(HON).endsWith(UI.suggestLine(HON).match(/be (\$[\d.]+[KM]) short/)[1] + " short."), UI.suggestLine(HON));
  check("early goal: the status and the cards use the same one-decimal FI age", (() => {
    const t = UI.statusText(E49), a = +E49.progress.fiFrac.toFixed(1);
    return t.includes(`FI at about ${a}, `) && t.includes(`${+(a - 49).toFixed(1)} yr`) && UI.effectText(es, E49).includes("at about ");
  })(), UI.statusText(E49) + " / " + UI.effectText(es, E49));
  check("combo card subtitle", UI.cardText(combo, DS).detail === "Two smaller changes instead of one big one");

  // Speed: fast enough to rerun on every input change.
  const t0 = Date.now(); for (let i = 0; i < 5; i++) SG({}); const tOff = (Date.now() - t0) / 5;
  const t1 = Date.now(); for (let i = 0; i < 5; i++) SG({ houseOn: 1 }); const tOn = (Date.now() - t1) / 5;
  check(`speed: defaults ${tOff.toFixed(1)} ms (< 30), house on ${tOn.toFixed(1)} ms (< 50)`, tOff < 30 && tOn < 50);

  // ui.js strings.
  check("summary (defaults): the combo, ranked first", UI.suggestSummary(DS) === "Best: save $14.8K/yr more + retire at 67", UI.suggestSummary(DS));
  check("summary: a single save names its accounts (5 accounts)", UI.suggestSummary({ ...DS, best: dsave }) === "Best: save $19.7K/yr more (5 accounts)");
  check("summary: one account is named", UI.suggestSummary(R4) === "Best: save $2K/yr more (HSA)", UI.suggestSummary(R4));
  check("summary: on track names the best opportunity", UI.suggestSummary(OT).startsWith("On track: could "), UI.suggestSummary(OT));
  check("summary: already there, and bad ages", UI.suggestSummary(EFI) === "You're already there" && UI.suggestSummary(SG({ age: 60, retAge: 60 })) === "Fix the ages first");
  check("summary fits a 375px row (under 46 characters)", [DS, R4, OT, C45, E49, HS, SG({ houseOn: 1 })].every((sg) => UI.suggestSummary(sg).length <= 46));
  check("hero line (defaults): save $19.7K/yr more, retire at 75, or spend $40.3K/yr (rounded like the summary)",
    UI.suggestLine(DS) === "Closest steps: save $19.7K/yr more, retire at 75, or spend $40.3K/yr.", UI.suggestLine(DS));
  check("hero line: empty when on track; names the goal otherwise", UI.suggestLine(OT) === "" && UI.suggestLine(C45).startsWith("Closest steps to coast by 45: "));
  const ct = UI.cardText(dsave, DS);
  check("save card: title, monthly and share of pay", ct.title === "Save $19,700/yr more" && ct.detail === "$1,642/mo together · 16% of pay", J(ct));
  check("save card: one line per account, all from → to (as many lines as accounts)",
    J(ct.split) === J(["HSA $1,400 → $8,750 (family limit)", "Partner A Roth IRA $3,200 → $7,500 (limit)", "Partner B Roth IRA $3,200 → $7,500 (limit)",
      "Partner A 401(k) $4,800 → $6,700", "Partner B 401(k) $4,800 → $6,650"]) && ct.split.length === dsave.steps.length, J(ct.split));
  check("save card: effect, chips, match note, why and take-home", ct.effect === "Reaches $1.78M by 65 (now $1.01M)" &&
    ct.chips.some((c) => c.word === "16% of pay") && ct.chips.some((c) => c.word === "Roth income limits apply") &&
    ct.note.includes("whole match") && ct.why.startsWith("Why this order") && ct.side === "Take-home about $1,640/mo lower (before tax effects).", J(ct));
  const cs = UI.cardText(by(DS, "spend"), DS);
  check("spend card", cs.title === "Plan on $40,300/yr in retirement" && cs.detail === "43% less than your $71,000 plan" &&
    cs.effect === "Your $1.01M would cover $40,300/yr at your 4.0% withdrawal rate" && cs.chips.some((c) => c.word === "Large cut") &&
    cs.sizeLabel === "Effort: very big", J(cs));
  const cr = UI.cardText(by(DS, "retLater"), DS);
  check("retire-later card", cr.title === "Retire at 75 instead of 65" && cr.detail === "10 more working years", J(cr));
  check("coast cards", UI.cardText(by(C45, "coastBoth"), C45).title === "Keep saving until 49, not 45" &&
    UI.cardText(by(C45, "coastA"), C45).title === "Only A keeps saving to 50" && UI.cardText(by(C45, "coastA"), C45).detail === "B still coasts at 45");
  check("combo card", UI.cardText(combo, DS).title.startsWith("Two smaller steps: "));
  check("opportunity cards: titles; 'no cushion' is said once above the list, not on each card", UI.cardText(op("spendMore"), OT).title === "Spend up to $19,000/yr (+$4,000)" &&
    UI.cardText(op("retireSooner"), OT).title === "Retire at 48, 2 yrs sooner" && OT.list.every((s) => !UI.cardText(s, OT).note.includes("no cushion")));
  check("opportunity effect: spending more is said as coverage, the rest against the same target",
    UI.effectText(op("spendMore"), OT) === "Your $380K would cover $19,000/yr at your 5.0% withdrawal rate" &&
    UI.effectText(op("retireSooner"), OT) === "Still reaches your $300K at 48", UI.effectText(op("spendMore"), OT) + " / " + UI.effectText(op("retireSooner"), OT));
  check("coast sooner: 'could stop saving at 48 instead of 50'", UI.cardText(op("coastSooner", "both"), OT).title === "Both of you could stop saving at 48 instead of 50",
    UI.cardText(op("coastSooner", "both"), OT).title);
  check("not-on-its-own line", UI.rejectedText(C40).startsWith("Not on its own: saving more (coasting at 40 leaves no years to save)"), UI.rejectedText(C40));
  check("sensitivity text (defaults)", UI.sensitivityText(DS) === "For reference, your plan as entered would need an 11.1% return a year before inflation " +
    "(you assume 7.0%), or a 7.0% withdrawal rate (you assume 4.0%). This shows how sensitive the plan is; it isn't something to plan on.", UI.sensitivityText(DS));
  check("disclaimer", UI.DISCLAIMER.startsWith("Educational estimates from this model, not financial advice."));
  check("applied toast text", UI.appliedText(dsave, DS) === "Applied: save $19,700/yr more.");
}

// ---------- how you compare: benchmarks and percentiles (SPEC 13) ----------
{
  // The data file: frozen, every series names a listed source, every source links over https,
  // and cutpoints rise with the percentile in every band.
  check("benchmarks are deep-frozen", Object.isFrozen(BENCH) && Object.isFrozen(BENCH.financialAssets.bands[0]));
  const series = [BENCH.cpi, BENCH.financialAssets, BENCH.retirementAccounts, BENCH.savingRates.vanguard, BENCH.savingRates.fidelity,
    BENCH.householdIncome, BENCH.earnings.ftyr, BENCH.earnings.blsWeekly, BENCH.fidelityGuide, BENCH.retirementAge.ebri,
    BENCH.retirementAge.gallup, BENCH.retirementAge.gallupBefore60, BENCH.retirementAge.crr, BENCH.spending, BENCH.socialSecurity];
  check("every benchmark series names a listed source", series.every((x) => BENCH.sources[x.src]), series.filter((x) => !BENCH.sources[x.src]).map((x) => x.src).join());
  check("every benchmark source links over https", Object.values(BENCH.sources).every((q) => /^https:\/\//.test(q.url) && q.label));
  const rising = (o) => { const c = CF.cutsOf(o); return c.every((q, i) => i === 0 || q.v >= c[i - 1].v); };
  const bandSets = [BENCH.financialAssets.bands, BENCH.financialAssets.couples, BENCH.retirementAccounts.bands.map((b) => b.uncond),
    BENCH.retirementAccounts.couples.filter((b) => b.uncond).map((b) => b.uncond), [BENCH.householdIncome.all, BENCH.earnings.blsWeekly.age16plus, BENCH.earnings.blsWeekly.age25plus]];
  check("published cutpoints rise with the percentile", bandSets.every((set) => set.every(rising)));
  check("the SCF age bands cover 18 and up with no gaps", [BENCH.financialAssets.bands, BENCH.retirementAccounts.bands].every((bs) =>
    bs[0].age[0] === 18 && bs[bs.length - 1].age[1] === 120 && bs.every((b, i) => i === 0 || b.age[0] === bs[i - 1].age[1] + 1)));

  // CPI: today = value x 336.940 / the year's average; the stored note's factors to 4 places.
  eq("CPI factor 2025 = 336.940 / 321.943", CF.cpiFactor(BENCH, 2025), 336.940 / 321.943, 1e-12);
  check("CPI factors match the note: 2022 1.1513, 2023 1.1058, 2024 1.0741, 2025 1.0466",
    [[2022, 1.1513], [2023, 1.1058], [2024, 1.0741], [2025, 1.0466]].every(([y, f]) => Math.abs(CF.cpiFactor(BENCH, y) - f) < 0.00005));
  check("current-dollar series and rates are not inflated (null, 2026 -> 1)", CF.cpiFactor(BENCH, null) === 1 && CF.cpiFactor(BENCH, 2026) === 1);

  // Age bands: inclusive at both ends; none under 18 in the SCF.
  const fa = BENCH.financialAssets.bands;
  check("age bands: 34 -> 18-34, 35 -> 35-44, 44 -> 35-44, 120 -> 75+, 17 -> none",
    CF.bandOf(fa, 34).age[1] === 34 && CF.bandOf(fa, 35).age[0] === 35 && CF.bandOf(fa, 44).age[0] === 35 &&
    CF.bandOf(fa, 120).age[0] === 75 && CF.bandOf(fa, 17) === null);
  check("cutsOf sorts by percentile, scales, and ignores means and other keys",
    J(CF.cutsOf({ p90: 9, mean: 99, p25: 2, median: 5, p50: 5 }, 2)) === J([{ p: 25, v: 4 }, { p: 50, v: 10 }, { p: 90, v: 18 }]));

  // Percentiles, hand-worked on cutpoints a factor of 4 apart: P25 100, P50 400, P75 1600, P90 6400.
  const C = CF.cutsOf({ p25: 100, p50: 400, p75: 1600, p90: 6400 }), LOG = { log: true };
  const P = (x, cuts, o) => CF.percentileOf(x, cuts || C, o === undefined ? LOG : o);
  check("log interpolation: 200 is halfway in log terms from 100 to 400 -> 25 + 12.5 = 37.5 -> 38", P(200).kind === "in" && P(200).p === 38);
  check("linear interpolation: 200 is a third of the way from 100 to 400 -> 33", P(200, C, {}).p === 33);
  check("log: 800 -> 50 + 25 x ln 2 / ln 4 = 62.5 -> 63", P(800).p === 63);
  check("on a cutpoint: 100 -> the 25th", P(100).kind === "in" && P(100).p === 25);
  check("below the lowest cutpoint is not extrapolated: 99 -> below the 25th", P(99).kind === "below" && P(99).p === 25 && P(0).kind === "below");
  check("at the top cutpoint: 6400 -> top 10%, no number", P(6400).kind === "top" && P(6400).top === 10 && !P(6400).approx);
  check("just under the top cutpoint stays under it: 6399 -> 89, never 90", P(6399).kind === "in" && P(6399).p === 89);
  check("just under an inner cutpoint never shows its percentile: 399 -> 49, not 50", P(399).kind === "in" && P(399).p === 49);
  // Zeros: P25 and P50 are 0, so $0 is "at least 50% have none", and a small balance is linear from (50, 0).
  const Z = CF.cutsOf({ p25: 0, p50: 0, p75: 1000, p90: 4000 });
  check("zero cutpoints: $0 -> zero, at least the 50th", P(0, Z).kind === "zero" && P(0, Z).p === 50);
  check("from the highest zero cutpoint, linear: 500 of 1,000 -> 50 + 12.5 -> 63", P(500, Z).p === 63);
  check("above zeros, log again: 2,000 between 1,000 and 4,000 -> 75 + 7.5 -> 83", P(2000, Z).p === 83);
  check("a negative cutpoint interpolates linearly: 0 between -1,000 (P10) and 1,000 (P25) -> 18",
    P(0, CF.cutsOf({ p10: -1000, p25: 1000 })).p === 18);
  // A Pareto tail through P90 = 100 and P99 = 1000: alpha = 1, top share = 10% x (x / 100)^-1.
  const T = CF.cutsOf({ p50: 10, p90: 100, p99: 1000 });
  check("Pareto tail: 200 -> top ~5%, shown as approximate", P(200, T).kind === "top" && P(200, T).top === 5 && P(200, T).approx);
  check("Pareto tail: 100 -> top ~10%; 1,000 and up -> top 1% (not approximate)",
    P(100, T).top === 10 && P(1000, T).top === 1 && !P(1000, T).approx && P(5000, T).top === 1);
  check("below P90 with a P99, ordinary interpolation: 50 -> 50 + 40 x ln 5 / ln 10 = 78", P(50, T).kind === "in" && P(50, T).p === 78);
  check("no cutpoints or no number -> none", CF.percentileOf(5, []).kind === "none" && P(NaN).kind === "none");

  // Fidelity: 1x at 30, 3x at 40, 6x at 50, 8x at 60, 10x at 67; linear between; nothing before 30.
  const G = BENCH.fidelityGuide.points;
  check("Fidelity guideline: 29 none, 30 1x, 35 2x, 42 3.6x, 63.5 9x, 67 10x, 80 10x",
    CF.guidelineMultiple(G, 29) === null && CF.guidelineMultiple(G, 30) === 1 && near(CF.guidelineMultiple(G, 35), 2, 1e-12) &&
    near(CF.guidelineMultiple(G, 42), 3.6, 1e-12) && near(CF.guidelineMultiple(G, 63.5), 9, 1e-12) &&
    CF.guidelineMultiple(G, 67) === 10 && CF.guidelineMultiple(G, 80) === 10);
  const TG = BENCH.savingRates.vanguard.target;
  check("Vanguard's target by pay: 49,999 -> 9%, 50,000 and 100,000 -> 12%, 100,001 -> 15%",
    CF.savingTarget(TG, 49999) === 9 && CF.savingTarget(TG, 50000) === 12 && CF.savingTarget(TG, 100000) === 12 && CF.savingTarget(TG, 100001) === 15);

  // The defaults (two incomes of 62,608 at 42, 45,000 invested), each comparison by hand.
  const F25 = CF.cpiFactor(BENCH, 2025), F24 = CF.cpiFactor(BENCH, 2024);
  const D = CF.compare({}, BENCH);
  check("defaults: a couple aged 42", D.couple === true && D.age === 42 && J(D.partners) === J(["A", "B"]));
  // 1. 45,000 against 35-44: P50 31,300 and P75 163,000 (2025 dollars, x F25) -> 50 + 25 ln(45,000 / 31,300 F25) / ln(163,000 / 31,300) = 54.8.
  const lnp = (x, a, b, pa, pb) => pa + (pb - pa) * Math.log(x / a) / Math.log(b / a);
  eq("defaults, invested: the hand formula gives 54.8", lnp(45000, 31300 * F25, 163000 * F25, 50, 75), 54.8, 0.05);
  check("defaults, invested: about the 55th percentile for 35-44", D.assets.r.kind === "in" && D.assets.r.p === 55 && J(D.assets.band) === J([35, 44]));
  eq("defaults, invested: the median shown is 31,300 in today's dollars", D.assets.cuts[1].v, 31300 * F25, 1e-6);
  check("defaults, invested: below the couples' median (58,300 x F25)", D.assets.couples.r.kind === "below" && D.assets.couples.r.p === 50 && near(D.assets.couples.cuts[0].v, 58300 * F25, 1e-6));
  // 2. Couples 35-44 with none counted: P50 25,000, P75 163,000 -> 50 + 25 ln(45,000 / 25,000 F25) / ln(163,000 / 25,000) = 57.2.
  eq("defaults, retirement: the hand formula gives 57.2", lnp(45000, 25000 * F25, 163000 * F25, 50, 75), 57.2, 0.05);
  check("defaults, retirement: couples' cutpoints, about the 57th", D.retirement.group === "couples" && D.retirement.r.p === 57 && D.retirement.x === 45000);
  check("defaults, retirement: 68.4% of couples hold one, median 80,000 in today's dollars",
    D.retirement.holders.group === "couples" && D.retirement.holders.pct === 68.4 && near(D.retirement.holders.median, 80000 * F25, 1e-6));
  // 3. (4,800 + 4.3% of 62,608) / 62,608 = 11.97%; with Roth and HSA about 22,784 / 125,216 = 18.20%.
  eq("defaults, saving: 401(k) + employer = 11.97% of pay", D.saving.planRate, (4800 + 0.043 * 62608) / 62608 * 100, 1e-9);
  eq("defaults, saving: everything = (2 x 4,800 + 8.6% of 62,608 + 2 x 3,200 + 1,400) / 125,216 = 18.20%", D.saving.totalRate,
    (2 * 4800 + 0.086 * 62608 + 2 * 3200 + 1400) / 125216 * 100, 1e-9);
  check("defaults, saving: 12% target for this pay, just missed; nobody maxes; 7.2% average deferral at 35-44",
    D.saving.people.every((q) => q.target === 12 && !q.meets && !q.maxed) && !D.saving.anyMaxed && D.saving.ageDeferral === 7.2);
  // 4. 125,216 between P60 110,300 and P80 182,400 (x F25) -> 60 + 20 ln(...) / ln(...) = 63.2.
  eq("defaults, income: the hand formula gives 63.2", lnp(125216, 110300 * F25, 182400 * F25, 60, 80), 63.2, 0.05);
  check("defaults, income: about the 63rd percentile; married-couple median 132,400 and age median 114,100 in today's dollars",
    D.income.r.p === 63 && D.income.peer.kind === "married" && near(D.income.peer.median, 132400 * F25, 1e-6) && near(D.income.ageMedian, 114100 * F25, 1e-6));
  // Each 62,608 against full-time workers 25+ (weekly x 52): P25 893 x 52, P50 1,330 x 52 -> 25 + 25 ln(...) / ln(1330 / 893) = 43.8.
  eq("defaults, pay: the hand formula gives 43.8", lnp(62608, 893 * 52, 1330 * 52, 25, 50), 43.8, 0.05);
  check("defaults, pay: each about the 44th; median for 35-44 is 74,910 in today's dollars; BLS figures not inflated",
    D.income.people.every((q) => q.r.p === 44 && near(q.median, 74910 * F25, 1e-6)) && D.income.payCuts[2].v === 1330 * 52);
  // 5. 45,000 / 125,216 = 0.36x against 3.6x at 42.
  check("defaults, multiple: 0.36x against a 3.6x guideline", near(D.multiple.x, 45000 / 125216, 1e-12) && near(D.multiple.guide, 3.6, 1e-12));
  // 6, 7.
  check("defaults, retirement age: 65 against 65 expected and 62 actual", D.retAge.x === 65 && D.retAge.expected === 65 && D.retAge.actual === 62);
  eq("defaults, spending: 65+ households spend 61,432 x F24 (2024 dollars inflated)", D.spending.all65, 61432 * F24, 1e-6);
  eq("defaults, Social Security: 2,088.79 a month, not inflated, covers 35% of 71,000", D.spending.ssShare, 2088.79 * 12 / 71000, 1e-12);

  // Couples vs single: one income compares with all households, the nonfamily median, and one person's pay.
  const S1 = CF.compare({ two: 0 }, BENCH);
  check("one income: no couples cut, all-household retirement cutpoints, 59.6% holders",
    S1.couple === false && S1.assets.couples === null && S1.retirement.group === "all" && S1.retirement.holders.pct === 59.6);
  check("one income: nonfamily median 52,200 in today's dollars, one person's pay only",
    S1.income.peer.kind === "single" && near(S1.income.peer.median, 52200 * F25, 1e-6) && S1.income.x === 62608 && S1.income.people.length === 1);
  // All families 35-44: P50 7,000, P75 95,000 -> 50 + 25 ln(45,000 / 7,000 F25) / ln(95,000 / 7,000) = 67.4.
  check("one income: retirement accounts about the 67th of all families 35-44", S1.retirement.r.p === Math.round(lnp(45000, 7000 * F25, 95000 * F25, 50, 75)) && S1.retirement.r.p === 67);
  const C70 = CF.compare({ age: 70, retAge: 75 }, BENCH);
  check("a couple at 70: no couples-only spread, so all households (and says so); holders from couples",
    C70.retirement.group === "all" && C70.retirement.couplesMissing && C70.retirement.holders.group === "couples");
  const Y0 = CF.compare({ age: 27, assets: 0, two: 0 }, BENCH);
  check("nothing invested at 27: below P25 of assets, none yet in retirement accounts", Y0.assets.r.kind === "below" && Y0.retirement.r.kind === "zero");
  check("retirement accounts leave out Taxable + cash", CF.compare({ taxable: 20000 }, BENCH).retirement.x === 25000);
  const MX = CF.compare({ kA: 24500 }, BENCH);
  check("maxing the 401(k) meets the target whatever the rate", MX.saving.people[0].maxed && MX.saving.people[0].meets && MX.saving.anyMaxed);
  const TEEN = CF.compare({ age: 16 }, BENCH);
  check("under 18: no SCF comparison", TEEN.assets === null && TEEN.retirement === null);
  check("no pay: no saving rate, multiple or income percentile", (() => { const z = CF.compare({ salA: 0, salB: 0 }, BENCH); return z.saving === null && z.multiple === null && z.income.r.kind === "below"; })());

  // Words (ui.js).
  check("ordinals", [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(UI.ordinal).join() === "1st,2nd,3rd,4th,11th,12th,13th,21st,22nd,23rd,101st,111th");
  check("age bands in words", UI.bandWords([18, 34]) === "under 35" && UI.bandWords([35, 44]) === "35–44" && UI.bandWords([75, 120]) === "75 and over");
  check("a rate just under its target shows two decimals", UI.rateVs(11.967, 12) === "11.97%" && UI.rateVs(12.04, 12) === "12.0%" && UI.rateVs(11.4, 12) === "11.4%");
  check("multiples", UI.mult(0) === "0×" && UI.mult(45000 / 125216) === "0.36×" && UI.mult(3.6) === "3.6×" && UI.mult(6) === "6×");
  check("summary (defaults): ~55th percentile of households your age", UI.compareSummary(D) === "~55th percentile of households your age", UI.compareSummary(D));
  check("summary: below, top, under 18", UI.compareSummary(Y0) === "below the 25th percentile of households your age" &&
    UI.compareSummary(CF.compare({ assets: 2000000 }, BENCH)) === "top 10% of households your age" && UI.compareSummary(TEEN) === "for ages 18 and up");
  const items = UI.compareItems(D, BENCH), byId = Object.fromEntries(items.map((x) => [x.id, x]));
  check("seven comparisons, each with a title, value, sentence and a source with a link",
    items.length === 7 && items.every((x) => x.title && x.value && x.line && x.sources.length && x.sources.every((q) => q.url && q.year)));
  check("defaults, invested sentence", byId.assets.line === "Your $45K invested is about the 55th percentile for households aged 35–44, where the median is $32.8K.", byId.assets.line);
  check("defaults, retirement value and holders line", byId.retire.value === "~57th percentile (couples)" &&
    byId.retire.subs[0] === "Among the 68% of couples your age who have an account, the median is $83.7K.", byId.retire.subs[0]);
  check("defaults, saving value and target line", byId.saving.value === "12.0% vs 11.6% typical" && byId.saving.subs.some((t) => t.endsWith("A and B each: 11.97%, a hair under the 12% target.")));
  check("no 401(k) at all: not contributing yet", UI.compareItems(CF.compare({ kA: 0, kB: 0, empA: 0, empB: 0 }, BENCH), BENCH)[2].subs
    .some((t) => t.endsWith("A and B each: not contributing yet (target 12%).")));
  check("retirement accounts cite the SCF tables (share, median) and the public data (percentiles)",
    J(byId.retire.sources.map((q) => q.label)) === J([BENCH.sources.scf_tables.label, BENCH.sources.scf_micro.label]));
  check("household income cites Census Table 1 for the medians", byId.income.sources.some((q) => q.label === BENCH.sources.census_t1.label));
  check("past 67 the guideline is 10x by 67, not a figure for that age", UI.compareItems(CF.compare({ age: 70, retAge: 75 }, BENCH), BENCH)[4].line
    .endsWith("Fidelity's guideline is 10× by 67."));
  check("retirement age: medians and CRR's labor-force ages in words", byId.retage.line.endsWith("retirees' median actual age was 62.") &&
    byId.retage.subs.some((t) => t.includes("by about 64½ for men and 62½ for women, fewer than half still work")));
  eq("spending without personal insurance and pensions: 57,952 x F24", D.spending.core65, 57952 * F24, 1e-6);
  check("the $0 share for the strip: 51% of households under 35 have no account", near(Y0.retirement.noneShare, 51.2, 1e-9));
  // One income at 42 with 1,000 in accounts: P25 = 0, but 40.4% hold none, so linear from (40.4, 0) to (50, 7,000 x F25) -> 41.7.
  const R1 = CF.compare({ two: 0, assets: 1000 }, BENCH).retirement;
  check("retirement accounts: a $0 cutpoint at the share with none (40.4% at 35-44); 1,000 -> 42nd",
    near(R1.cuts[1].p, 40.4, 1e-9) && R1.cuts[1].v === 0 && R1.r.p === Math.round(40.4 + 9.6 * 1000 / (7000 * F25)) && R1.r.p === 42);
  check("defaults, income: equal salaries read as one line", byId.income.subs[0].startsWith("A and B each earn $62.6K: about the 44th percentile"), byId.income.subs[0]);
  check("defaults, multiple, retirement age and spending values", byId.multiple.value === "0.36× vs 3.6× guideline" &&
    byId.retage.value === "65 vs 62 actual" && byId.spend.value === "$71K vs $66K at 65+", [byId.multiple.value, byId.retage.value, byId.spend.value].join(" | "));
  check("defaults, Social Security line: one covers 35%, two 71%", byId.spend.subs[0].includes("would cover 35% of it; two would cover 71%"), byId.spend.subs[0]);
  check("nothing in retirement accounts at 27: the share with none", UI.compareItems(Y0, BENCH)[1].line === "Like about 51% of households aged under 35, you don't have money in retirement accounts yet.");
  check("before 60 adds Gallup's rarity line and its source", (() => { const it = UI.compareItems(CF.compare({ retAge: 55 }, BENCH), BENCH)[5];
    return it.subs.some((t) => t.startsWith("Only about 12%")) && it.sources.some((q) => q.url.includes("snapshot-americans")); })());
  check("the note says approximate and not advice", /approximate/.test(UI.COMPARE_NOTE) && /not financial advice/.test(UI.COMPARE_NOTE));
}

// ---------- privacy scan: no stray amounts, no spreadsheets ----------
// Every concrete number must trace back to SPEC.md: cited defaults and their sources,
// the 2026 limits, the test scenarios above, slider limits, and years.
const ALLOWED_NUMBERS = new Set([
  // defaults and their sources (SPEC 8)
  45000, 71000, 80830, 9652, 71178, 62608, 1204, 4800, 4821, 3200, 3211, 3482, 1400, 1440,
  // 2026 limits
  24500, 7500, 8750, 4400, 8800, 8000, 11250, 1100,
  // test scenarios and hand-checked values (tests, SPEC 9)
  100000, 50000, 10000, 5000, 20000, 28000, 380000, 400000, 320000, 330000, 240000, 17000, 340000, 352000, 337000,
  15000, 2000, 6000, 4000, 1000, 3000, 30000, 19000, 500000, 1000000, 410000, 40000, 57822, 30772, 9227, 16137, 6909,
  7682, 15386, 46137, 22784, 1200, 13000, 14000, 1775000, 1009932, 42452, 600000, 800000, 200000, 90000, 9000, 1500,
  // slider and field limits
  250000, 2000000, 300000, 907029, 22000, 99999, 1250000,
  // formatting examples
  634890, 634891, 1525000, 999999, 999400, 999600, 1127, 1128, 1500000, 1234567, 45200, 61000,
  // the home (SPEC 11.9) and its test scenarios (SPEC 11.8)
  418000, 417500, 1600, 1530, 1531, 1569, 4528, 1798, 2531, 120000, 96000, 24000, 356000, 51200, 44800, 431200, 78000,
  190000, 80000, 5333, 53333, 16000, 76000, 12000, 41800, 12540, 54340, 3588, 2604, 376200, 297000, 297433, 594000,
  594411, 1715273, 900000, 38000, 650000, 2400, 2650,
  // suggestions (SPEC 12) and their test scenarios. All worked from the section 9 fixture (H0: R4, R5,
  // C45, DR, OT, E49) or the cited defaults (DS: save 19,700 = 42,452 - 22,784 rounded up; its split
  // 8,750 / 7,500 / 6,700 / 6,650; the combo's partial Roth 6,950 / 6,900; spend 40,300), never real data.
  6900, 6950,
  // the review's scenarios: buying now short of cash (75000 spending), one low income (60000 spending)
  60000, 75000,
  1234, 1300, 1850, 1900, 2500, 2600, 2750, 4300, 5250, 6650, 6700, 6750, 7000, 7350, 8100, 11600, 11650, 13500, 14500, 16600, 16750, 19050, 19100, 19500, 19700, 19900, 21650, 23250, 25000, 36500, 40300, 70900, 77500, 150000, 260000, 270000, 280000,
  // years (sources, the seed, the Trinity study)
  1998, 2022, 2023, 2024, 2025, 2026, 20261016,
  // how you compare (SPEC 13): the percentile scenarios and the defaults' household pay
  6400, 6399, 49999, 100001, 125216,
  // the tests' random-number generator
  1103515245, 12345, 2147483648,
]);
const ALLOWED = new Set([
  "$45,000", "$71,000", "$80,830", "$9,652", "$71,178", "$62,608", "$1,204", "$4,800", "$4,821", "$3,200", "$3,211", "$3,482",
  "$1,400", "$1,440",
  "$24,500", "$7,500", "$8,750", "$4,400", "$8,800", "$8,000", "$11,250", "$1,100",
  "$1,000,000", "$57,822", "$57,822.29", "$22,784", "$42,452", "$1,775,000", "$1,009,932", "$10,000",
  "$500,000", "$1,000", "$1,234,567", "$1,500.50", "$61,000", "$40,000", "$20,000", "$100,000",
  "$1.78M", "$1.01M", "$1.5M", "$1M", "$635K", "$45K", "$999K", "$1.2T", "$2.5B", "$100K", "$1,128", "$500K", "$5K", "$10K",
  "$418,000", "$417,500", "$1,530", "$1,531", "$1,600", "$1,569", "$14K",
  "$1,640", "$1,642", "$1,850", "$1,900", "$14,800", "$19,000", "$19,700", "$19.7K", "$20K", "$2K", "$310,000", "$4,000", "$40,300", "$40.3K",
  "$23K", "$42K", "$40K", "$5,000", "$50,000", "$6,000", "$2,000", "$28,000", "$634,891", "$71000",
  // suggestions copy: the defaults' combo ($14.8K) and split ($6,700 / $6,650), the on-track fixture ($380K, $300K)
  "$14.8K", "$6,700", "$6,650", "$380K", "$300K",
  // the review's implausible-lever scenario (one income, $60,000 spending: spend $10,700 isn't offered)
  "$60,000", "$10,700",
  // SPEC 12 examples at the defaults with the home on (house at 45): the gap, its own FIRE number, the floored price
  "$1.42M", "$1.40M", "$46,000",
  // how you compare (SPEC 13): the defaults' sentences in today's dollars
  "$32.8K", "$83.7K", "$62.6K", "$71K", "$66K",
]);
// benchmarks.js holds published survey figures (SPEC 13). Its numbers may appear in any file, but
// each must also be written in SPEC.md (checked below), so nothing private can hide among them.
const benchText = fs.readFileSync(path.join(ROOT, "benchmarks.js"), "utf8").replace(/https?:\/\/\S+/g, "");
const BENCH_NUMBERS = new Set([...benchText.matchAll(/(?<![\w.$,])\d{4,}(?![\w])/g)].map((m) => Number(m[0])));
// Only figures of 1,000 or more: small numbers (ages, rates, years' digits) would let "$50K" through.
const BENCH_VALUES = new Set([...benchText.matchAll(/(?<![\w.])\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => n >= 1000));
// "$132,400", "$2,088.79", "$150K" -> the number, to look up among the published figures.
const dollarValue = (t) => {
  const m = t.replace(/[$,\s]/g, "").match(/^([\d.]+)([KMBT]?)$/);
  return m ? Number(m[1]) * { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]] : NaN;
};
let files;
try {
  files = execSync("git ls-files --cached --others --exclude-standard", { cwd: ROOT, encoding: "utf8" })
    .split("\n").map((s) => s.trim()).filter(Boolean);
} catch (e) {
  files = [];
  const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((f) => {
    const rel = d ? d + "/" + f.name : f.name;
    if (f.name === ".git") return;
    if (f.isDirectory()) walk(rel); else files.push(rel);
  });
  walk("");
}
const spreadsheets = files.filter((f) => /\.(xlsx?|csv|numbers|ods)$/i.test(f));
check("no spreadsheets would be committed", spreadsheets.length === 0, spreadsheets.join(", "));
// The amounts in one file's text that are not on the allowlists.
function strayAmounts(f, text) {
  const out = [];
  // Dollar amounts in any form: with commas, without, or abbreviated (K, M, B, T)
  for (const m of text.matchAll(/\$\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?|\$\d{4,}(?:\.\d+)?|\$\d+(?:\.\d+)?\s?[KMBT]\b/g)) {
    if (!ALLOWED.has(m[0].replace(/\s/g, "")) && !BENCH_VALUES.has(dollarValue(m[0]))) out.push(`${f}: ${m[0]}`);
  }
  // Bare numbers of 4+ digits in code and pages (hex colors and URLs skipped), with or without commas.
  if (/\.(js|html)$/i.test(f)) {
    const plain = text.replace(/https?:\/\/\S+/g, "").replace(/#[0-9a-f]{3,8}\b/gi, "");
    for (const m of plain.matchAll(/(?<![\w.$,])\d{1,3}(?:,\d{3})+(?![\d])|(?<![\w.$,])\d{4,}(?![\w])/g)) {
      const n = Number(m[0].replace(/,/g, ""));
      if (!ALLOWED_NUMBERS.has(n) && !BENCH_NUMBERS.has(n)) out.push(`${f}: ${m[0]}`);
    }
  }
  return out;
}
// The scan itself catches the forms a hard-coded real number would take.
// (Built from pieces so this file doesn't trip its own scan.)
const DS = "$", cat = (...parts) => parts.join("");
const planted = strayAmounts("x.js",
  `a = "${DS}${cat("1,", "234,", "568")}", b = "${DS}${cat("8,", "601")}", c = "${DS}${cat("1.", "3M")}", d = ${cat("52", "001")}, e = "${cat("121,", "001")}", x = "#1d6b47";`);
check("privacy scan catches $N,NNN,NNN, $N,NNN, $N.NM and bare numbers", planted.length === 5, planted.join("; "));
check("privacy scan ignores bare numbers in Markdown, and hex colors",
  strayAmounts("x.md", cat("52", "001")).length === 0 && strayAmounts("x.js", "color: #" + cat("121", "614") + ";").length === 0);
const stray = [];
for (const f of files) {
  if (!/\.(html|js|css|md|json|webmanifest|svg|txt|py|ps1)$/i.test(f) && !/^\.gitignore$/.test(f)) continue;
  stray.push(...strayAmounts(f, fs.readFileSync(path.join(ROOT, f), "utf8")));
}
check(`no unexpected amounts in ${files.length} published files`, stray.length === 0, stray.join("; "));
// The allowlists can't drift: every entry must be written in SPEC.md or in this file's
// own scenarios (the text outside the two allowlists).
const ownText = fs.readFileSync(__filename, "utf8")
  .replace(/const ALLOWED_NUMBERS = new Set\(\[[\s\S]*?\]\);/, "").replace(/const ALLOWED = new Set\(\[[\s\S]*?\]\);/, "");
const traceText = fs.readFileSync(path.join(ROOT, "SPEC.md"), "utf8") + "\n" + ownText;
const written = (n) => [String(n), n.toLocaleString("en-US")].some((form) =>
  new RegExp("(?<![\\d,])" + form + "(?!\\d|,\\d)").test(traceText));
const untraced = [...ALLOWED_NUMBERS].filter((n) => !written(n))
  .concat([...ALLOWED].filter((a) => !traceText.includes(a) && !traceText.includes(a.replace(/^\$/, ""))));
check("every allowlisted amount is written in SPEC.md or a test scenario", untraced.length === 0, untraced.join(", "));
const specText = fs.readFileSync(path.join(ROOT, "SPEC.md"), "utf8");
const benchUntraced = [...BENCH_NUMBERS].filter((n) => ![String(n), n.toLocaleString("en-US")].some((form) =>
  new RegExp("(?<![\\d,])" + form + "(?!\\d|,\\d)").test(specText)));
check(`every figure in benchmarks.js (${BENCH_NUMBERS.size}) is written in SPEC.md section 13`, benchUntraced.length === 0, benchUntraced.join(", "));

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
