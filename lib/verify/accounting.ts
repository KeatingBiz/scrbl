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

const NUM_CURRENCY = "([\\$()\\-+\\s]*\\d[\\d,]*\\.?\\d*%?)"; // $, commas, parentheses-negatives, optional %
const NUM_SIMPLE = "(-?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";

function cleanMoneyish(s: string): string {
  return s.replace(/[\$,]/g, "").trim();
}
function parseMoneyish(s: string | null | undefined): number | null {
  if (!s) return null;
  const hasParens = /\(.*\)/.test(s);
  const t = cleanMoneyish(s.replace(/[()]/g, ""));
  const m = t.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/i);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return hasParens ? -n : n;
}

function findLabeled(
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

function pushCheck(
  checks: Verification["checks"],
  label: string,
  lhs: number,
  rhs: number,
  tolAbs = 1e-6,
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

  const looksAccounting =
    /\b(accounting|assets?|liabilit(?:y|ies)|equity|stockholders|shareholders|journal|debit|credit|cogs|inventory|fifo|lifo|weighted\s*average|depreciation|straight\s*line|double\s*declining|units\s*of\s*production|current\s*ratio|quick\s*ratio|acid[-\s]*test|gross\s*margin|roe|roa|debt[-\s]*to[-\s]*equity|break[-\s]*even|contribution\s*margin|cvp|fixed\s*costs?|variable\s*cost|net\s*income|income\s*statement)/i.test(
      lower
    );

  if (!looksAccounting) return null;

  const checks: Verification["checks"] = [];

  /* ========== 0) Income statement arithmetic → Net Income ========== */
  if (/\b(net\s*income|income\s*statement|ni)\b/i.test(lower)) {
    const Sales = findLabeled(text, ["sales", "revenue", "net\\s*sales"]);
    const COGS = findLabeled(text, ["cogs", "cost\\s*of\\s*goods\\s*sold"]);
    const SGA  = findLabeled(text, ["sga", "selling\\s*,?\\s*general\\s*and\\s*admin", "operating\\s*expenses?"]);
    const RnD  = findLabeled(text, ["r&d", "research\\s*and\\s*development"]);
    const Dep  = findLabeled(text, ["depreciation", "dep"]);
    const Int  = findLabeled(text, ["interest\\s*expense", "interest"]);
    const TaxesAmt = findLabeled(text, ["tax(?:es)?\\s*expense", "tax(?:es)?"]);
    const TaxRate  = parsePercentOrNumber(
      (text.match(/\b(tax\s*rate|t)\s*[:=]\s*([()\-$\d.,\s]*\d+(?:\.\d+)?%)/i)?.[2]) || ""
    );

    if (Sales != null && COGS != null) {
      const EBIT = (Sales - COGS) - (SGA ?? 0) - (RnD ?? 0) - (Dep ?? 0);
      const EBT  = EBIT - (Int ?? 0);
      const NI   = TaxesAmt != null ? (EBT - TaxesAmt) : (TaxRate != null ? (EBT * (1 - TaxRate)) : NaN);

      if (Number.isFinite(NI) && finalNum != null) {
        pushCheck(checks, "net_income", NI, finalNum, 0.01, 1e-6);
      }
    }
  }

  /* ========== 1) Accounting equation: A = L + E ========== */
  {
    const A = findLabeled(text, ["assets", "total\\s*assets", "a"]);
    const L = findLabeled(text, ["liabilities", "total\\s*liabilities", "debt", "l"]);
    const E = findLabeled(text, ["equity", "stockholders'?\\s*equity", "shareholders'?\\s*equity", "owners'?\\s*equity", "e"]);

    if (A != null && L != null && E != null) {
      const lhs = A;
      const rhs = L + E;
      const ok = relClose(lhs, rhs, 1e-6, 1e-2) || approxEqual(lhs, rhs, 1e-2);
      checks.push({ value: "A=L+E", ok, lhs, rhs, reason: ok ? null : "Accounting equation not satisfied" } as any);
    } else if (finalNum != null) {
      if (A == null && L != null && E != null && (/\bassets?\b/i.test(finalS) || /\bA\s*=\b/.test(finalS))) {
        pushCheck(checks, "assets", L + E, finalNum, 0.01);
      } else if (L == null && A != null && E != null && (/\bliabilit|debt\b/i.test(finalS) || /\bL\s*=\b/.test(finalS))) {
        pushCheck(checks, "liabilities", A - E, finalNum, 0.01);
      } else if (E == null && A != null && L != null && (/\bequity\b/i.test(finalS) || /\bE\s*=\b/.test(finalS))) {
        pushCheck(checks, "equity", A - L, finalNum, 0.01);
      }
    }
  }

  /* ========== 2) Journal entry balance: sum(Debit) = sum(Credit) ========== */
  if (/\b(journal|entry|debit|credit|dr|cr)\b/.test(lower)) {
    const debits: number[] = [];
    const credits: number[] = [];

    // Line-wise tolerant scan: pick the FIRST money-like amount on each line tagged as debit/credit
    for (const line of text.split(/\r?\n/)) {
      const amtMatch = line.match(new RegExp(NUM_CURRENCY));
      const amt = amtMatch?.[1] ? parseMoneyish(amtMatch[1]) : null;
      if (amt == null) continue;

      if (/\b(debit|dr)\b/i.test(line)) debits.push(amt);
      if (/\b(credit|cr)\b/i.test(line)) credits.push(amt);
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
    const BI = findLabeled(text, ["beginning\\s*inventory", "bi"]);
    const Purch = findLabeled(text, ["purchases", "purchases\\s*total", "net\\s*purchases"]);
    const COGS = findLabeled(text, ["cogs", "cost\\s*of\\s*goods\\s*sold"]);
    const EI = findLabeled(text, ["ending\\s*inventory", "ei"]);

    if (BI != null && Purch != null && COGS != null && EI != null) {
      const lhs = BI + Purch - COGS;
      const rhs = EI;
      const ok = relClose(lhs, rhs, 1e-6, 0.01) || approxEqual(lhs, rhs, 0.01);
      checks.push({ value: "BI+Purch-COGS=EI", ok, lhs, rhs, reason: ok ? null : "Inventory identity mismatch" } as any);
    } else if (finalNum != null) {
      if (EI == null && BI != null && Purch != null && COGS != null && (/\bending\s*inventory\b/i.test(finalS) || /\bEI\b/.test(finalS))) {
        pushCheck(checks, "ending_inventory", BI + Purch - COGS, finalNum, 0.01);
      } else if (COGS == null && BI != null && Purch != null && EI != null && (/\bCOGS\b/i.test(finalS) || /cost\s*of\s*goods\s*sold/i.test(finalS))) {
        pushCheck(checks, "COGS", BI + Purch - EI, finalNum, 0.01);
      } else if (BI == null && Purch != null && COGS != null && EI != null && (/\bbeginning\s*inventory\b/i.test(finalS) || /\bBI\b/.test(finalS))) {
        pushCheck(checks, "beginning_inventory", EI + COGS - Purch, finalNum, 0.01);
      } else if (Purch == null && BI != null && COGS != null && EI != null && /\bpurchases\b/i.test(finalS)) {
        pushCheck(checks, "purchases", EI + COGS - BI, finalNum, 0.01);
      }
    }
  }

  /* ========== 4) Depreciation (SL / DDB / UoP) ========== */
  if (/\b(depreciation|straight\s*line|double\s*declining|ddb|units\s*of\s*production|uop)\b/i.test(lower)) {
    const cost = findLabeled(text, ["cost", "asset\\s*cost", "purchase\\s*price"]);
    const salvage = findLabeled(text, ["salvage", "residual", "salvage\\s*value", "residual\\s*value"]) ?? 0;
    const life = findLabeled(text, ["life", "useful\\s*life", "years"], NUM_SIMPLE);
    const year = findLabeled(text, ["year", "period"], NUM_SIMPLE);

    // Units-of-production inputs
    const totalUnits = findLabeled(text, ["total\\s*units", "capacity", "lifetime\\s*units"], NUM_SIMPLE);
    const unitsThis  = findLabeled(text, ["units\\s*produced", "units\\s*used", "hours\\s*used"], NUM_SIMPLE);

    // Straight-line
    if (/\b(straight\s*line|SL)\b/i.test(lower)) {
      if (cost != null && life != null) {
        const depPerYear = (cost - salvage) / life;
        if (finalNum != null && /\b(depre?c?i?a?t?i?o?n|expense|annual)\b/i.test(finalS)) {
          pushCheck(checks, "depreciation_SL", depPerYear, finalNum, 0.01);
        }
        if (year != null && year >= 1) {
          const accDep = Math.min(year, life) * depPerYear;
          const book = Math.max(cost - accDep, salvage);
          if (finalNum != null && /\b(book\s*value|BV)\b/i.test(finalS)) {
            pushCheck(checks, "book_value_SL", book, finalNum, 0.01);
          }
        }
      }
    }

    // Double-Declining Balance (salvage floor)
    if (/\b(double\s*declining|ddb)\b/i.test(lower)) {
      if (cost != null && life != null) {
        const rate = 2 / life;
        const y = Math.max(1, Math.floor(year ?? 1));
        let bv = cost;
        let depY = 0;
        for (let i = 1; i <= y; i++) {
          const dep = Math.min(bv * rate, Math.max(0, (bv - salvage)));
          const nextBV = Math.max(bv - dep, salvage);
          if (i === y) depY = bv - nextBV;
          bv = nextBV;
        }
        if (finalNum != null && /\b(depre?c?i?a?t?i?o?n|expense|annual)\b/i.test(finalS)) {
          pushCheck(checks, "depreciation_DDB_y", depY, finalNum, 0.01);
        }
        if (finalNum != null && /\b(book\s*value|BV)\b/i.test(finalS)) {
          pushCheck(checks, "book_value_DDB_y", bv, finalNum, 0.01);
        }
      }
    }

    // Units of Production
    if (/\b(units\s*of\s*production|uop)\b/i.test(lower)) {
      if (cost != null && totalUnits != null && unitsThis != null) {
        const rate = (cost - salvage) / totalUnits;
        const dep = rate * unitsThis;
        if (finalNum != null) pushCheck(checks, "depreciation_UoP", dep, finalNum, 0.01);
      }
    }
  }

  /* ========== 5) Ratios ========== */
  if (/\b(ratio|current\s*ratio|quick\s*ratio|acid[-\s]*test|debt[-\s]*to[-\s]*equity|gross\s*margin|roe|roa)\b/i.test(lower)) {
    const CA = findLabeled(text, ["current\\s*assets", "ca"]);
    const CL = findLabeled(text, ["current\\s*liabilities", "cl"]);
    const Inv = findLabeled(text, ["inventory"]);
    const Cash = findLabeled(text, ["cash", "cash\\s*and\\s*equivalents"]);
    const AR = findLabeled(text, ["accounts\\s*receivable", "ar"]);

    const Debt = findLabeled(text, ["debt", "total\\s*debt", "interest[-\\s]*bearing\\s*debt", "liabilities"]);
    const Equity = findLabeled(text, ["equity", "shareholders'?\\s*equity", "stockholders'?\\s*equity"]);

    const Sales = findLabeled(text, ["sales", "revenue", "net\\s*sales"]);
    const COGS = findLabeled(text, ["cogs", "cost\\s*of\\s*goods\\s*sold"]);
    const NI = findLabeled(text, ["net\\s*income", "profit", "earnings"]);

    if (/\bcurrent\s*ratio\b/i.test(lower) && CA != null && CL != null && finalNum != null) {
      pushCheck(checks, "current_ratio", CA / CL, finalNum, 1e-6, 1e-6);
    }
    if (/\b(quick\s*ratio|acid[-\s]*test)\b/i.test(lower) && CL != null && finalNum != null) {
      const quickNumer =
        (Cash ?? 0) + (AR ?? 0) + ((CA != null && Inv != null) ? Math.max(0, CA - Inv) - (Cash ?? 0) - (AR ?? 0) : 0);
      const val = quickNumer > 0 ? quickNumer / CL : (CA != null && Inv != null ? (CA - Inv) / CL : NaN);
      if (Number.isFinite(val)) pushCheck(checks, "quick_ratio", val, finalNum, 1e-6, 1e-6);
    }
    if (/\bdebt[-\s]*to[-\s]*equity\b/i.test(lower) && Debt != null && Equity != null && finalNum != null) {
      pushCheck(checks, "debt_to_equity", Debt / Equity, finalNum, 1e-6, 1e-6);
    }
    if (/\bgross\s*margin\b/i.test(lower) && Sales != null && COGS != null && finalNum != null) {
      const gm = (Sales - COGS) / Sales;
      pushCheck(checks, "gross_margin", gm, finalNum, 1e-6, 1e-6);
    }
    if (/\broa\b|return\s*on\s*assets/i.test(lower) && NI != null && (findLabeled(text, ["assets", "total\\s*assets"]) != null) && finalNum != null) {
      const A = findLabeled(text, ["assets", "total\\s*assets"])!;
      pushCheck(checks, "ROA", NI / A, finalNum, 1e-6, 1e-6);
    }
    if (/\broe\b|return\s*on\s*equity/i.test(lower) && NI != null && Equity != null && finalNum != null) {
      pushCheck(checks, "ROE", NI / Equity, finalNum, 1e-6, 1e-6);
    }
  }

  /* ========== 6) CVP / Break-even ========== */
  if (/\b(break[-\s]*even|contribution\s*margin|cvp|target\s*profit)\b/i.test(lower)) {
    const price = findLabeled(text, ["price\\s*per\\s*unit", "selling\\s*price\\s*per\\s*unit", "p"], NUM_CURRENCY);
    const vcu = findLabeled(text, ["variable\\s*cost\\s*per\\s*unit", "vcu", "vc"], NUM_CURRENCY);
    const fixed = findLabeled(text, ["fixed\\s*costs?", "fc", "fixed\\s*expenses?"], NUM_CURRENCY);
    const target = findLabeled(text, ["target\\s*profit", "desired\\s*profit", "profit\\s*target"], NUM_CURRENCY);

    if (price != null && vcu != null && fixed != null) {
      const CM = price - vcu;
      if (CM > 0) {
        const beUnits = fixed / CM;
        const beSales = beUnits * price;
        if (finalNum != null) {
          if (/\b(units?|q)\b/i.test(finalS)) {
            pushCheck(checks, "break_even_units", beUnits, finalNum, 1e-4, 1e-6);
          } else if (/\$|sales|revenue/i.test(finalS)) {
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

  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "accounting", method: "accounting-core", allVerified, checks } as unknown as Verification;
}



