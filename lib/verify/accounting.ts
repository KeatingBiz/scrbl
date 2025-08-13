// lib/verify/accounting.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import {
  gatherProblemText,
  parseNumber,
  parsePercentOrNumber,
  approxEqual,
  relClose,
} from "./utils";

/* ---------------------------- helpers ---------------------------- */

// Money-ish number with $, commas, optional percent, or (parentheses) negatives
const NUM_CURRENCY = "([()\\$\\-\\s]*\\d[\\d,]*\\.?\\d*%?)";
const NUM_SIMPLE = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";

function cleanMoneyish(s: string): string {
  return s.replace(/[\s,]/g, "");
}
function parseMoneyish(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = cleanMoneyish(s);
  // parentheses as negatives: e.g., ($2,000) or (2000)
  const paren = t.match(/\(\$?(-?\d[\d,]*\.?\d*)%?\)/i);
  if (paren && paren[1]) return -parseFloat(paren[1].replace(/,/g, ""));
  const m = t.match(/\$?(-?\d[\d,]*\.?\d*)%?/i);
  return m ? parseFloat(m[1].replace(/,/g, "")) : null;
}

function findLabeledFirst(
  text: string,
  labels: string[],
  pattern: string = NUM_CURRENCY
): number | null {
  for (const label of labels) {
    const re = new RegExp(`\\b${label}\\b\\s*[:=]?\\s*${pattern}`, "i");
    const m = text.match(re);
    if (m && m[1]) {
      const v = parseMoneyish(m[1]);
      if (v != null) return v;
    }
  }
  return null;
}

function findAllLabeledSum(
  text: string,
  labels: string[],
  pattern: string = NUM_CURRENCY
): number | null {
  let sum = 0;
  let found = false;
  for (const label of labels) {
    const re = new RegExp(`\\b${label}\\b\\s*[:=]?\\s*${pattern}`, "gi");
    const it = text.matchAll(re);
    for (const m of it) {
      if (m && m[1]) {
        const v = parseMoneyish(m[1]);
        if (v != null) {
          sum += v;
          found = true;
        }
      }
    }
  }
  return found ? sum : null;
}

function pushCheck(
  checks: Verification["checks"],
  label: string,
  lhs: number,
  rhs: number,
  tolAbs = 1e-2,
  tolRel = 1e-6
) {
  const ok = relClose(lhs, rhs, tolRel, tolAbs) || approxEqual(lhs, rhs, tolAbs);
  checks.push({ value: `${label}=${rhs}`, ok, lhs, rhs, reason: ok ? null : `${label} mismatch` } as any);
}

/* ---------------------------- main ---------------------------- */

export function verifyAccounting(result: BoardUnderstanding): Verification | null {
  const blobRaw = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blobRaw.replace(/[–—−]/g, "-");
  const lower = text.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalNum = parsePercentOrNumber(finalS) ?? parseMoneyish(finalS);

  // Does this look like an accounting question?
  const looksAccounting =
    /\b(accounting|assets?|liabilit(?:y|ies)|equity|stockholders|shareholders|journal|debit|credit|cogs|inventory|fifo|lifo|weighted\s*average|depreciation|straight\s*line|double\s*declining|units\s*of\s*production|income\s*statement|net\s*income|current\s*ratio|quick\s*ratio|acid[-\s]*test|gross\s*margin|roe|roa|debt[-\s]*to[-\s]*equity|break[-\s]*even|contribution\s*margin|cvp|fixed\s*costs?|variable\s*cost)/i.test(
      lower
    );

  if (!looksAccounting) return null;

  const checks: Verification["checks"] = [];

  /* ========== 1) Accounting equation: A = L + E ========== */
  {
    const A = findLabeledFirst(text, ["assets", "total\\s*assets", "a"]);
    const L = findLabeledFirst(text, ["liabilities", "total\\s*liabilities", "debt", "l"]);
    const E = findLabeledFirst(text, [
      "equity",
      "stockholders'?\\s*equity",
      "shareholders'?\\s*equity",
      "owners'?\\s*equity",
      "e",
    ]);

    // Identity if all three present
    if (A != null && L != null && E != null) {
      const lhs = A;
      const rhs = L + E;
      const ok = relClose(lhs, rhs, 1e-6, 1e-2) || approxEqual(lhs, rhs, 1e-2);
      checks.push({ value: "A=L+E", ok, lhs, rhs, reason: ok ? null : "Accounting equation not satisfied" } as any);
    } else if (finalNum != null) {
      // Solve for whichever is missing and compare with final if the final mentions it
      if (A == null && L != null && E != null && (/\bassets?\b/i.test(finalS) || /\bA=/.test(finalS))) {
        pushCheck(checks, "assets", L + E, finalNum);
      } else if (L == null && A != null && E != null && (/\bliabilit|debt\b/i.test(finalS) || /\bL=/.test(finalS))) {
        pushCheck(checks, "liabilities", A - E, finalNum);
      } else if (E == null && A != null && L != null && (/\bequity\b/i.test(finalS) || /\bE=/.test(finalS))) {
        pushCheck(checks, "equity", A - L, finalNum);
      }
    }
  }

  /* ========== 2) Journal entry balance: sum(Debit) = sum(Credit) ========== */
  if (/\b(journal|entry|debit|credit|dr|cr)\b/.test(lower)) {
    const debits: number[] = [];
    const credits: number[] = [];

    const debitMatches = text.matchAll(new RegExp(`\\b(?:debit|dr)\\b[^\\d(\\$\\n-]*${NUM_CURRENCY}`, "gi"));
    for (const m of debitMatches) {
      const v = parseMoneyish(m[1]);
      if (v != null) debits.push(v);
    }
    const creditMatches = text.matchAll(new RegExp(`\\b(?:credit|cr)\\b[^\\d(\\$\\n-]*${NUM_CURRENCY}`, "gi"));
    for (const m of creditMatches) {
      const v = parseMoneyish(m[1]);
      if (v != null) credits.push(v);
    }

    if (debits.length + credits.length >= 2) {
      const sumD = debits.reduce((s, v) => s + v, 0);
      const sumC = credits.reduce((s, v) => s + v, 0);
      const ok = relClose(sumD, sumC, 1e-6, 0.01) || approxEqual(sumD, sumC, 0.01);
      checks.push({
        value: "journal-balanced",
        ok,
        lhs: sumD,
        rhs: sumC,
        reason: ok ? null : "Debits ≠ Credits",
      } as any);
    }
  }

  /* ========== 3) Inventory identity: BI + Purchases - COGS = EI ========== */
  if (/\b(inventory|cogs|fifo|lifo|weighted\s*average)\b/.test(lower)) {
    const BI = findLabeledFirst(text, ["beginning\\s*inventory", "bi"]);
    const Purch = findLabeledFirst(text, ["purchases", "purchases\\s*total", "net\\s*purchases"]);
    const COGS = findLabeledFirst(text, ["cogs", "cost\\s*of\\s*goods\\s*sold"]);
    const EI = findLabeledFirst(text, ["ending\\s*inventory", "ei"]);

    if (BI != null && Purch != null && COGS != null && EI != null) {
      const lhs = BI + Purch - COGS;
      const rhs = EI;
      const ok = relClose(lhs, rhs, 1e-6, 0.01) || approxEqual(lhs, rhs, 0.01);
      checks.push({ value: "BI+Purch-COGS=EI", ok, lhs, rhs, reason: ok ? null : "Inventory identity mismatch" } as any);
    } else if (finalNum != null) {
      if (EI == null && BI != null && Purch != null && COGS != null && (/\bending\s*inventory\b/i.test(finalS) || /\bEI\b/i.test(finalS))) {
        pushCheck(checks, "ending_inventory", BI + Purch - COGS, finalNum);
      } else if (COGS == null && BI != null && Purch != null && EI != null && (/\bCOGS\b/i.test(finalS) || /cost\s*of\s*goods\s*sold/i.test(finalS))) {
        pushCheck(checks, "COGS", BI + Purch - EI, finalNum);
      } else if (BI == null && Purch != null && COGS != null && EI != null && (/\bbeginning\s*inventory\b/i.test(finalS) || /\bBI\b/i.test(finalS))) {
        pushCheck(checks, "beginning_inventory", EI + COGS - Purch, finalNum);
      } else if (Purch == null && BI != null && COGS != null && EI != null && /\bpurchases\b/i.test(finalS)) {
        pushCheck(checks, "purchases", EI + COGS - BI, finalNum);
      }
    }
  }

  /* ========== 4) Depreciation (SL / DDB / UoP) ========== */
  if (/\bdepreciation|straight\s*line|double\s*declining|ddb|units\s*of\s*production|uop\b/.test(lower)) {
    const cost = findLabeledFirst(text, ["cost", "asset\\s*cost", "purchase\\s*price"]);
    const salvage = findLabeledFirst(text, ["salvage", "residual", "salvage\\s*value", "residual\\s*value"]) ?? 0;
    const life = findLabeledFirst(text, ["life", "useful\\s*life", "years"], NUM_SIMPLE);
    const year = findLabeledFirst(text, ["year", "period"], NUM_SIMPLE);

    const totalUnits = findLabeledFirst(text, ["total\\s*units", "capacity", "lifetime\\s*units"], NUM_SIMPLE);
    const unitsThis = findLabeledFirst(text, ["units\\s*produced", "units\\s*used", "hours\\s*used"], NUM_SIMPLE);

    // Straight-line
    if (/\bstraight\s*line\b|\bSL\b/i.test(lower)) {
      if (cost != null && life != null) {
        const depPerYear = (cost - salvage) / life;
        if (finalNum != null && /\b(depre?c?i?a?t?i?o?n|expense|annual)\b/i.test(finalS)) {
          pushCheck(checks, "depreciation_SL", depPerYear, finalNum);
        }
        if (year != null && year >= 1) {
          const accDep = Math.min(year, life) * depPerYear;
          const book = Math.max(cost - accDep, salvage);
          if (finalNum != null && /\b(book\s*value|BV)\b/i.test(finalS)) {
            pushCheck(checks, "book_value_SL", book, finalNum);
          }
        }
      }
    }

    // Double-Declining Balance (with salvage floor)
    if (/\bdouble\s*declining|ddb\b/i.test(lower)) {
      if (cost != null && life != null) {
        const rate = 2 / life;
        const y = Math.max(1, Math.floor(year ?? 1));
        let bvStart = cost;
        let depY = 0;
        for (let i = 1; i <= y; i++) {
          const dep = Math.min(bvStart * rate, Math.max(0, bvStart - salvage));
          const nextBV = Math.max(bvStart - dep, salvage);
          if (i === y) depY = bvStart - nextBV;
          bvStart = nextBV;
        }
        const book = bvStart;
        if (finalNum != null && /\b(depre?c?i?a?t?i?o?n|expense|annual)\b/i.test(finalS)) {
          pushCheck(checks, "depreciation_DDB_y", depY, finalNum);
        }
        if (finalNum != null && /\b(book\s*value|BV)\b/i.test(finalS)) {
          pushCheck(checks, "book_value_DDB_y", book, finalNum);
        }
      }
    }

    // Units of Production
    if (/\bunits\s*of\s*production|uop\b/i.test(lower)) {
      if (cost != null && totalUnits != null && unitsThis != null) {
        const rate = (cost - salvage) / totalUnits;
        const dep = rate * unitsThis;
        if (finalNum != null) {
          pushCheck(checks, "depreciation_UoP", dep, finalNum);
        }
      }
    }
  }

  /* ========== 5) Ratios ========== */
  if (/\bratio|current\s*ratio|quick\s*ratio|acid[-\s]*test|debt[-\s]*to[-\s]*equity|gross\s*margin|roe|roa\b/.test(lower)) {
    const CA = findLabeledFirst(text, ["current\\s*assets", "ca"]);
    const CL = findLabeledFirst(text, ["current\\s*liabilities", "cl"]);
    const Inv = findLabeledFirst(text, ["inventory"]);
    const Cash = findLabeledFirst(text, ["cash", "cash\\s*and\\s*equivalents"]);
    const AR = findLabeledFirst(text, ["accounts\\s*receivable", "ar"]);
    const Prepaid = findLabeledFirst(text, ["prepaid", "prepayments"]);

    const Debt = findLabeledFirst(text, ["debt", "total\\s*debt", "interest[-\\s]*bearing\\s*debt", "liabilities"]);
    const Equity = findLabeledFirst(text, ["equity", "shareholders'?\\s*equity", "stockholders'?\\s*equity"]);

    const Sales = findLabeledFirst(text, ["sales", "revenue", "net\\s*sales"]);
    const COGS = findLabeledFirst(text, ["cogs", "cost\\s*of\\s*goods\\s*sold"]);
    const NI = findLabeledFirst(text, ["net\\s*income", "profit", "earnings"]);

    if (/\bcurrent\s*ratio\b/.test(lower) && CA != null && CL != null && finalNum != null) {
      pushCheck(checks, "current_ratio", CA / CL, finalNum, 1e-6, 1e-6);
    }
    if (/\b(quick\s*ratio|acid[-\s]*test)\b/.test(lower) && CL != null && finalNum != null) {
      const quickNumer =
        (Cash ?? 0) +
        (AR ?? 0) +
        ((CA != null && (Inv != null || Prepaid != null)) ? Math.max(0, CA - (Inv ?? 0) - (Prepaid ?? 0)) - (Cash ?? 0) - (AR ?? 0) : 0);
      const val = quickNumer > 0 ? quickNumer / CL : (CA != null && Inv != null ? (CA - Inv) / CL : NaN);
      if (Number.isFinite(val)) pushCheck(checks, "quick_ratio", val, finalNum, 1e-6, 1e-6);
    }
    if (/\bdebt[-\s]*to[-\s]*equity\b/.test(lower) && Debt != null && Equity != null && finalNum != null) {
      pushCheck(checks, "debt_to_equity", Debt / Equity, finalNum, 1e-6, 1e-6);
    }
    if (/\bgross\s*margin\b/.test(lower) && Sales != null && COGS != null && finalNum != null) {
      const gm = (Sales - COGS) / Sales;
      pushCheck(checks, "gross_margin", gm, finalNum, 1e-6, 1e-6);
    }
    if (/\broa\b|return\s*on\s*assets/.test(lower) && NI != null && (findLabeledFirst(text, ["assets", "total\\s*assets"]) != null) && finalNum != null) {
      const A = findLabeledFirst(text, ["assets", "total\\s*assets"])!;
      pushCheck(checks, "ROA", NI / A, finalNum, 1e-6, 1e-6);
    }
    if (/\broe\b|return\s*on\s*equity/.test(lower) && NI != null && Equity != null && finalNum != null) {
      pushCheck(checks, "ROE", NI / Equity, finalNum, 1e-6, 1e-6);
    }
  }

  /* ========== 6) Net Income recompute (Income Statement) ========== */
  if (/\b(net\s*income|income\s*statement|ebit|ebitda|operating\s*income|tax(?:es)?|tax\s*rate)\b/i.test(lower)) {
    // Revenues
    const sales =
      findLabeledFirst(text, ["net\\s*sales", "sales", "revenue", "total\\s*revenue"]) ??
      findAllLabeledSum(text, ["sales", "revenue"]);
    // COGS
    const cogs = findLabeledFirst(text, ["cogs", "cost\\s*of\\s*goods\\s*sold"]);
    // Operating expenses (sum many lines if present)
    const sga = findAllLabeledSum(text, ["selling\\s*expenses?", "administrative\\s*expenses?", "s(?:g|&|\\s*and\\s*)a"], NUM_CURRENCY);
    const rnd = findAllLabeledSum(text, ["r&d", "research\\s*&?\\s*development"], NUM_CURRENCY);
    const opexTotal = findLabeledFirst(text, ["operating\\s*expenses?", "total\\s*operating\\s*expenses?"], NUM_CURRENCY);
    const depreciation = findLabeledFirst(text, ["depreciation\\s*expense", "depr(?:eciation)?"], NUM_CURRENCY);
    const interest = findLabeledFirst(text, ["interest\\s*expense"], NUM_CURRENCY);
    const taxExpenseAbs = findLabeledFirst(text, ["income\\s*tax\\s*expense", "tax\\s*expense"], NUM_CURRENCY);
    const taxRate = parsePercentOrNumber(
      (text.match(/\b(tax\\s*rate|t)\s*[:=]?\s*([()\\$\\-\\s]*\\d[\\d,]*\\.?\\d*%?)/i)?.[2]) || ""
    ) ?? parsePercentOrNumber(text.match(/\bt\s*=\s*([\\d.]+%)/i)?.[1] || "");

    // Build EBIT/EBT/NI
    let NIcalc: number | null = null;

    if (sales != null) {
      const gp = cogs != null ? sales - cogs : null;

      // Operating expenses: prefer explicit "operating expenses" total; else sum SG&A + R&D (+ any other listed)
      let opx = opexTotal ?? 0;
      if (opx === 0) {
        if (sga != null) opx += sga;
        if (rnd != null) opx += rnd;
      }
      // If depreciation listed separately, add it (common in tests); otherwise assume it may be inside opx and don't add.
      if (depreciation != null && (opexTotal != null || (sga != null || rnd != null))) {
        opx += depreciation;
      }

      const EBIT = (gp ?? sales) - opx;
      const EBT = interest != null ? EBIT - interest : EBIT;

      if (taxExpenseAbs != null) {
        NIcalc = EBT - taxExpenseAbs;
      } else if (taxRate != null) {
        const tax = EBT * Math.max(0, taxRate);
        NIcalc = EBT - tax;
      }
    }

    if (NIcalc != null && finalNum != null) {
      pushCheck(checks, "net_income", NIcalc, finalNum, 0.01, 1e-6);
    }
  }

  /* ========== 7) CVP / Break-even ========== */
  if (/\bbreak[-\s]*even|contribution\s*margin|cvp|target\s*profit/i.test(lower)) {
    const price = findLabeledFirst(text, ["price\\s*per\\s*unit", "selling\\s*price\\s*per\\s*unit", "p"], NUM_CURRENCY);
    const vcu = findLabeledFirst(text, ["variable\\s*cost\\s*per\\s*unit", "vcu", "vc"], NUM_CURRENCY);
    const fixed = findLabeledFirst(text, ["fixed\\s*costs?", "fc", "fixed\\s*expenses?"], NUM_CURRENCY);
    const target = findLabeledFirst(text, ["target\\s*profit", "desired\\s*profit", "profit\\s*target"], NUM_CURRENCY);

    if (price != null && vcu != null && fixed != null) {
      const CM = price - vcu;
      if (CM > 0) {
        const beUnits = fixed / CM;
        const beSales = beUnits * price;

        if (finalNum != null) {
          if (/\bunits?\b|q\b/i.test(finalS) || /per\s*unit/i.test(lower)) {
            pushCheck(checks, "break_even_units", beUnits, finalNum, 1e-4, 1e-6);
          } else if (/\$|sales|revenue/i.test(finalS) || /sales/i.test(lower)) {
            pushCheck(checks, "break_even_sales", beSales, finalNum, 0.01, 1e-6);
          }
        }

        if (target != null && finalNum != null) {
          const unitsForTarget = (fixed + target) / CM;
          pushCheck(checks, "target_profit_units", unitsForTarget, finalNum, 1e-4, 1e-6);
        }
      }
    }
  }

  /* ========== verdict ========== */
  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "accounting", method: "accounting-core", allVerified, checks } as unknown as Verification;
}


