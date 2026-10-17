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
  check("nudge line (defaults): save more, retire at 75, or spend less",
    UI.nudgeLine(d) === `To get there by 65: save ~${kr(d.requiredAnnual)}/yr, retire at 75, or spend ~${kr(d.spendWithin)}/yr.`, UI.nudgeLine(d));
  check("nudge line reads aloud without the tilde", !UI.spoken(UI.nudgeLine(d)).includes("~") && UI.spoken("~x") === "about x");
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
  check("hash: sixteen new keys, all with short names", HK.every((k) => CF.KEYS.includes(k) && CF.HASH_KEYS[k]) && CF.KEYS.length === 47);
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
  // years (sources, the seed, the Trinity study)
  1998, 2022, 2023, 2024, 2025, 2026, 20261016,
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
  "$23K", "$42K", "$40K", "$5,000", "$50,000", "$6,000", "$2,000", "$28,000", "$634,891", "$71000",
]);
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
    if (!ALLOWED.has(m[0].replace(/\s/g, ""))) out.push(`${f}: ${m[0]}`);
  }
  // Bare numbers of 4+ digits in code and pages (hex colors and URLs skipped), with or without commas.
  if (/\.(js|html)$/i.test(f)) {
    const plain = text.replace(/https?:\/\/\S+/g, "").replace(/#[0-9a-f]{3,8}\b/gi, "");
    for (const m of plain.matchAll(/(?<![\w.$,])\d{1,3}(?:,\d{3})+(?![\d])|(?<![\w.$,])\d{4,}(?![\w])/g)) {
      if (!ALLOWED_NUMBERS.has(Number(m[0].replace(/,/g, "")))) out.push(`${f}: ${m[0]}`);
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

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
