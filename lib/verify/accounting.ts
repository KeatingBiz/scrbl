// lib/verify/accounting.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import {
  gatherProblemText,
  parseNumber,
  parsePercentOrNumber,
  approxEqual,
  relClose,
} from "./utils";

const NUM = "(-?\\d{1,3}(?:,\\d{3})*\\.?\\d*(?:e[+-]?\\d+)?|[-+]?\\d*\\.?\\d+(?:e[+-]?\\d+)?)";

function cleanNum(s: string): string {
  return s.replace(/[\$,()\s]/g, "").replace(/,/g, "");
}

function findNum(text: string, ...labels: RegExp[]): number | null {
  for (const lab of labels) {
    const m = text.match(lab);
    if (m && m[1]) {
      const n = parseNumber(cleanNum(m[1]));
      if (n != null) return n;
    }
  }
  return null;
}

function findPctOrNum(text: string, ...labels: RegExp[]): number | null {
  for (const lab of labels) {
    const m = text.match(lab);
    if (m && m[1]) {
      const n = parsePercentOrNumber(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

export function verifyAccounting(result: BoardUnderstanding): Verification | null {
  const blob = gatherProblemText(result.question, result.raw_text, result.steps);
  const text = blob.toLowerCase();
  const finalS = String(result.final ?? "");
  const finalN = parseNumber(cleanNum(finalS));
  const finalPct = parsePercentOrNumber(finalS);

  // quick smell test
  const looksAcct = /\b(assets?|liabilit(?:y|ies)|equity|retained\s*earnings?|revenue|sales|expenses?|cogs|inventory|current\s*ratio|quick\s*ratio|eps|depreciation|break-?even|contribution|margin|cm\s*ratio|operating\s*income|ebit|wip|overhead|pohr|applied|ar\s*turnover|inventory\s*turnover|roe|roa)\b/.test(
    text
  );
  if (!looksAcct) return null;

  const checks: Verification["checks"] = [];

  /* ===================== 1) Core identities & statement ties ===================== */
  // A = L + E
  const A = findNum(text, new RegExp(`\\bassets?\\s*=\\s*${NUM}`, "i"));
  const L = findNum(text, new RegExp(`\\bliabilit(?:y|ies)\\s*=\\s*${NUM}`, "i"));
  const E = findNum(text, new RegExp(`\\b(equity|stockholders'?\\s*equity|shareholders'?\\s*equity)\\s*=\\s*${NUM}`, "i"));
  if (finalN != null) {
    if (A != null && L != null && E == null) {
      const rhs = L + E!;
      const ok = relClose(A, rhs, 1e-8, 1e-8) || approxEqual(A, rhs, 1e-6);
      checks.push({ value: `A=L+E`, ok, lhs: A, rhs, reason: ok ? null : "Accounting equation mismatch" } as any);
    } else if (A != null && E != null && L == null) {
      const need = A - E;
      const ok = relClose(need, finalN, 1e-8, 1e-8) || approxEqual(need, finalN, 1e-6);
      checks.push({ value: `L=${finalN}`, ok, lhs: need, rhs: finalN, reason: ok ? null : "Liabilities mismatch" } as any);
    } else if (A != null && L != null && E != null) {
      const ok = relClose(A, L + E, 1e-8, 1e-8) || approxEqual(A, L + E, 1e-6);
      checks.push({ value: `A=L+E`, ok, lhs: A, rhs: L + E, reason: ok ? null : "A != L+E" } as any);
    }
  }

  // Net income = Revenues - Expenses
  const Rev = findNum(text, new RegExp(`\\b(net\\s*)?(sales|revenue|revenues)\\s*=\\s*${NUM}`, "i"));
  const Exp = findNum(text, new RegExp(`\\b(total\\s*)?expenses?\\s*=\\s*${NUM}`, "i"));
  const NI = findNum(text, new RegExp(`\\b(net\\s*income|ni)\\s*=\\s*${NUM}`, "i"));
  if (Rev != null && Exp != null) {
    const calc = Rev - Exp;
    if (finalN != null) {
      const ok = relClose(calc, finalN, 1e-8, 1e-6) || approxEqual(calc, finalN, 1e-6);
      checks.push({ value: `NI=${finalN}`, ok, lhs: calc, rhs: finalN, reason: ok ? null : "NI = Rev - Exp mismatch" } as any);
    } else if (NI != null) {
      const ok = relClose(calc, NI, 1e-8, 1e-6) || approxEqual(calc, NI, 1e-6);
      checks.push({ value: `NI check`, ok, lhs: calc, rhs: NI, reason: ok ? null : "NI mismatch" } as any);
    }
  }

  // RE_end = RE_begin + NI − Dividends
  const REb = findNum(text, new RegExp(`\\b(retained\\s*earnings?|re)\\s*(beg(?:in(?:ning)?)?|start)\\s*=\\s*${NUM}`, "i"));
  const REe = findNum(text, new RegExp(`\\b(retained\\s*earnings?|re)\\s*(end|ending|closing)\\s*=\\s*${NUM}`, "i"));
  const Div = findNum(text, new RegExp(`\\b(dividends?|div)\\s*=\\s*${NUM}`, "i"));
  if (REb != null && (NI != null || (Rev != null && Exp != null)) && Div != null && finalN != null) {
    const niUse = NI != null ? NI : (Rev! - Exp!);
    const calc = REb + niUse - Div;
    const ok = relClose(calc, finalN, 1e-8, 1e-6) || approxEqual(calc, finalN, 1e-6);
    checks.push({ value: `RE_end=${finalN}`, ok, lhs: calc, rhs: finalN, reason: ok ? null : "RE_end formula mismatch" } as any);
  }

  /* ===================== 2) EPS ===================== */
  const PrefDiv = findNum(text, new RegExp(`\\b(pref(?:erred)?\\s*dividends?)\\s*=\\s*${NUM}`, "i"));
  const Sh = findNum(text, new RegExp(`\\b(weighted\\s*avg\\s*shares?|shares?)\\s*=\\s*${NUM}`, "i"));
  if (NI != null && Sh != null && finalN != null) {
    const num = NI - (PrefDiv ?? 0);
    const eps = num / Sh;
    const ok = relClose(eps, finalN, 1e-6, 1e-6) || approxEqual(eps, finalN, 1e-6);
    checks.push({ value: `EPS=${finalN}`, ok, lhs: eps, rhs: finalN, reason: ok ? null : "EPS mismatch" } as any);
  }

  /* ===================== 3) Key ratios ===================== */
  const CA = findNum(text, new RegExp(`\\bcurrent\\s*assets?\\s*=\\s*${NUM}`, "i"));
  const CL = findNum(text, new RegExp(`\\bcurrent\\s*liabilit(?:y|ies)\\s*=\\s*${NUM}`, "i"));
  const Inv = findNum(text, new RegExp(`\\binventor(?:y|ies)\\s*=\\s*${NUM}`, "i"));
  const Sales = Rev ?? findNum(text, new RegExp(`\\b(net\\s*)?sales\\s*=\\s*${NUM}`, "i"));
  const COGS = findNum(text, new RegExp(`\\bcogs|cost\\s*of\\s*goods\\s*sold\\s*=\\s*${NUM}`, "i"));
  const OpInc = findNum(text, new RegExp(`\\b(operating\\s*income|ebit)\\s*=\\s*${NUM}`, "i"));
  const AvgAssets = findNum(text, new RegExp(`\\bavg(?:erage)?\\s*assets?\\s*=\\s*${NUM}`, "i"));
  const AvgEquity = findNum(text, new RegExp(`\\bavg(?:erage)?\\s*(equity|shareholders'?\\s*equity)\\s*=\\s*${NUM}`, "i"));
  const AvgInv = findNum(text, new RegExp(`\\bavg(?:erage)?\\s*inventor(?:y|ies)\\s*=\\s*${NUM}`, "i"));
  const AvgAR = findNum(text, new RegExp(`\\bavg(?:erage)?\\s*(a\\/r|ar|accounts\\s*receivable)\\s*=\\s*${NUM}`, "i"));

  // current ratio
  if (CA != null && CL != null) {
    const cr = CL === 0 ? NaN : CA / CL;
    if (Number.isFinite(cr)) {
      if (finalPct != null) {
        const ok = relClose(cr, finalPct, 1e-6, 1e-6) || approxEqual(cr, finalPct, 1e-6);
        checks.push({ value: `current_ratio=${finalPct}`, ok, lhs: cr, rhs: finalPct, reason: ok ? null : "CR mismatch" } as any);
      } else if (finalN != null) {
        const ok = relClose(cr, finalN, 1e-6, 1e-6) || approxEqual(cr, finalN, 1e-6);
        checks.push({ value: `current_ratio=${finalN}`, ok, lhs: cr, rhs: finalN, reason: ok ? null : "CR mismatch" } as any);
      }
    }
  }

  // quick ratio
  if (CA != null && CL != null && Inv != null) {
    const qr = CL === 0 ? NaN : (CA - Inv) / CL;
    if (Number.isFinite(qr)) {
      const target = finalPct ?? finalN;
      if (target != null) {
        const ok = relClose(qr, target, 1e-6, 1e-6) || approxEqual(qr, target, 1e-6);
        checks.push({ value: `quick_ratio=${target}`, ok, lhs: qr, rhs: target, reason: ok ? null : "Quick ratio mismatch" } as any);
      }
    }
  }

  // debt-to-equity
  if (L != null && E != null) {
    const de = E === 0 ? NaN : L / E;
    if (Number.isFinite(de)) {
      const target = finalPct ?? finalN;
      if (target != null) {
        const ok = relClose(de, target, 1e-6, 1e-6) || approxEqual(de, target, 1e-6);
        checks.push({ value: `debt_equity=${target}`, ok, lhs: de, rhs: target, reason: ok ? null : "D/E mismatch" } as any);
      }
    }
  }

  // margins
  if (Sales != null) {
    if (COGS != null) {
      const gpm = (Sales - COGS) / Sales;
      const target = finalPct;
      if (target != null) {
        const ok = relClose(gpm, target, 1e-6, 1e-6) || approxEqual(gpm, target, 1e-6);
        checks.push({ value: `gross_margin=${target}`, ok, lhs: gpm, rhs: target, reason: ok ? null : "Gross margin mismatch" } as any);
      }
    }
    if (OpInc != null) {
      const om = OpInc / Sales;
      if (finalPct != null) {
        const ok = relClose(om, finalPct, 1e-6, 1e-6) || approxEqual(om, finalPct, 1e-6);
        checks.push({ value: `operating_margin=${finalPct}`, ok, lhs: om, rhs: finalPct, reason: ok ? null : "Operating margin mismatch" } as any);
      }
    }
    if (NI != null && finalPct != null) {
      const nm = NI / Sales;
      const ok = relClose(nm, finalPct, 1e-6, 1e-6) || approxEqual(nm, finalPct, 1e-6);
      checks.push({ value: `net_margin=${finalPct}`, ok, lhs: nm, rhs: finalPct, reason: ok ? null : "Net margin mismatch" } as any);
    }
  }

  // ROA / ROE
  if (NI != null && AvgAssets != null && finalPct != null) {
    const roa = AvgAssets === 0 ? NaN : NI / AvgAssets;
    if (Number.isFinite(roa)) {
      const ok = relClose(roa, finalPct, 1e-6, 1e-6) || approxEqual(roa, finalPct, 1e-6);
      checks.push({ value: `ROA=${finalPct}`, ok, lhs: roa, rhs: finalPct, reason: ok ? null : "ROA mismatch" } as any);
    }
  }
  if (NI != null && AvgEquity != null && finalPct != null) {
    const roe = AvgEquity === 0 ? NaN : NI / AvgEquity;
    if (Number.isFinite(roe)) {
      const ok = relClose(roe, finalPct, 1e-6, 1e-6) || approxEqual(roe, finalPct, 1e-6);
      checks.push({ value: `ROE=${finalPct}`, ok, lhs: roe, rhs: finalPct, reason: ok ? null : "ROE mismatch" } as any);
    }
  }

  // Turnover & days
  if (COGS != null && AvgInv != null) {
    const it = AvgInv === 0 ? NaN : COGS / AvgInv;
    if (Number.isFinite(it)) {
      if (/\bdays\b|\bdio\b|\bdsi\b/i.test(text) && finalN != null) {
        const daysInv = 365 / it;
        const ok = relClose(daysInv, finalN, 1e-5, 1e-6) || approxEqual(daysInv, finalN, 1e-3);
        checks.push({ value: `days_inventory=${finalN}`, ok, lhs: daysInv, rhs: finalN, reason: ok ? null : "Days inventory mismatch" } as any);
      } else if (finalN != null) {
        const ok = relClose(it, finalN, 1e-6, 1e-6) || approxEqual(it, finalN, 1e-6);
        checks.push({ value: `inventory_turnover=${finalN}`, ok, lhs: it, rhs: finalN, reason: ok ? null : "Inv turnover mismatch" } as any);
      }
    }
  }
  const NetCreditSales = findNum(text, new RegExp(`\\b(net\\s*credit\\s*sales)\\s*=\\s*${NUM}`, "i")) ?? Sales;
  if (NetCreditSales != null && AvgAR != null) {
    const art = AvgAR === 0 ? NaN : NetCreditSales / AvgAR;
    if (Number.isFinite(art)) {
      if (/\bdso\b|\bdays\s*sales\s*outstanding\b|\bday(s)?\b/i.test(text) && finalN != null) {
        const dso = 365 / art;
        const ok = relClose(dso, finalN, 1e-5, 1e-6) || approxEqual(dso, finalN, 1e-3);
        checks.push({ value: `DSO=${finalN}`, ok, lhs: dso, rhs: finalN, reason: ok ? null : "DSO mismatch" } as any);
      } else if (finalN != null) {
        const ok = relClose(art, finalN, 1e-6, 1e-6) || approxEqual(art, finalN, 1e-6);
        checks.push({ value: `AR_turnover=${finalN}`, ok, lhs: art, rhs: finalN, reason: ok ? null : "AR turnover mismatch" } as any);
      }
    }
  }

  /* ===================== 4) CVP / Break-even ===================== */
  const F = findNum(text, new RegExp(`\\b(fixed\\s*costs?|f)\\s*=\\s*${NUM}`, "i"));
  const P = findNum(text, new RegExp(`\\b(price|p)\\s*(per\\s*unit)?\\s*=\\s*${NUM}`, "i"));
  const V = findNum(text, new RegExp(`\\b(variable\\s*costs?|vc?|v)\\s*(per\\s*unit)?\\s*=\\s*${NUM}`, "i"));
  const targetProf = findNum(text, new RegExp(`\\b(target\\s*profit|profit)\\s*=\\s*${NUM}`, "i"));
  if (F != null && P != null && V != null) {
    const cm = P - V;
    const cmr = P !== 0 ? cm / P : NaN;
    if (cm <= 0) {
      // not economically viable; still can flag
      checks.push({ value: "CM<=0", ok: false, reason: "Contribution margin ≤ 0" } as any);
    } else {
      if (/break[-\s]*even|\bbep?\b/i.test(text)) {
        if (finalN != null) {
          const q = F / cm;
          const ok = relClose(q, finalN, 1e-6, 1e-6) || approxEqual(q, finalN, 1e-6);
          checks.push({ value: `Q*=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "Break-even units mismatch" } as any);
        } else if (finalPct != null && Number.isFinite(cmr)) {
          const ok = relClose(cmr, finalPct, 1e-6, 1e-6) || approxEqual(cmr, finalPct, 1e-6);
          checks.push({ value: `CM_ratio=${finalPct}`, ok, lhs: cmr, rhs: finalPct, reason: ok ? null : "CM ratio mismatch" } as any);
        }
      }
      if (/target\s*profit/i.test(text) && targetProf != null && finalN != null) {
        const q = (F + targetProf) / cm;
        const ok = relClose(q, finalN, 1e-6, 1e-6) || approxEqual(q, finalN, 1e-6);
        checks.push({ value: `Q_target=${finalN}`, ok, lhs: q, rhs: finalN, reason: ok ? null : "Target profit units mismatch" } as any);
      }
    }
  }

  /* ===================== 5) Depreciation ===================== */
  const Cost = findNum(text, new RegExp(`\\b(cost|asset\\s*cost)\\s*=\\s*${NUM}`, "i"));
  const Salv = findNum(text, new RegExp(`\\b(salvage|residual)\\s*value\\s*=\\s*${NUM}`, "i"));
  const Life = findNum(text, new RegExp(`\\b(life|useful\\s*life|n\\s*years?)\\s*=\\s*${NUM}`, "i"));
  const Year = findNum(text, new RegExp(`\\b(year)\\s*=\\s*${NUM}`, "i"));
  // Straight-line
  if (/straight[-\s]*line|sl\b/i.test(text) && Cost != null && Life != null) {
    const dep = (Cost - (Salv ?? 0)) / Life;
    if (/\bbook\s*value\b/i.test(text) && Year != null && finalN != null) {
      const bv = Cost - dep * Math.min(Year, Life);
      const ok = relClose(bv, finalN, 1e-6, 1e-6) || approxEqual(bv, finalN, 1e-6);
      checks.push({ value: `BV=${finalN}`, ok, lhs: bv, rhs: finalN, reason: ok ? null : "SL BV mismatch" } as any);
    } else if (finalN != null) {
      const ok = relClose(dep, finalN, 1e-6, 1e-6) || approxEqual(dep, finalN, 1e-6);
      checks.push({ value: `Dep_SL=${finalN}`, ok, lhs: dep, rhs: finalN, reason: ok ? null : "SL dep mismatch" } as any);
    }
  }
  // Double-declining balance (DDB)
  if (/\b(ddb|double[-\s]*declin)/i.test(text) && Cost != null && Life != null && Year != null) {
    const rate = (2 / Life);
    let bvBeg = Cost;
    for (let y = 1; y <= Year; y++) {
      const depY = bvBeg * rate;
      const nextBV = Math.max((Salv ?? 0), bvBeg - depY);
      if (y === Year) {
        if (/\bbook\s*value\b/i.test(text) && finalN != null) {
          const ok = relClose(nextBV, finalN, 1e-6, 1e-6) || approxEqual(nextBV, finalN, 1e-6);
          checks.push({ value: `BV_DDB=${finalN}`, ok, lhs: nextBV, rhs: finalN, reason: ok ? null : "DDB BV mismatch" } as any);
        } else if (finalN != null) {
          const ok = relClose(depY, finalN, 1e-6, 1e-6) || approxEqual(depY, finalN, 1e-6);
          checks.push({ value: `DepY_DDB=${finalN}`, ok, lhs: depY, rhs: finalN, reason: ok ? null : "DDB dep mismatch" } as any);
        }
      }
      bvBeg = nextBV;
    }
  }
  // Sum-of-years'-digits (SYD)
  if (/\b(syd|sum[-\s]*of[-\s]*years)/i.test(text) && Cost != null && Life != null && Year != null) {
    const base = Cost - (Salv ?? 0);
    const denom = (Life * (Life + 1)) / 2;
    const remaining = Life - (Year - 1); // year 1 has remaining = Life
    const depY = base * (remaining / denom);
    if (/\bbook\s*value\b/i.test(text) && finalN != null) {
      // BV after Year
      let acc = 0;
      for (let y = 1; y <= Year; y++) {
        const rem = Life - (y - 1);
        acc += base * (rem / denom);
      }
      const bv = Cost - acc;
      const ok = relClose(bv, finalN, 1e-6, 1e-6) || approxEqual(bv, finalN, 1e-6);
      checks.push({ value: `BV_SYD=${finalN}`, ok, lhs: bv, rhs: finalN, reason: ok ? null : "SYD BV mismatch" } as any);
    } else if (finalN != null) {
      const ok = relClose(depY, finalN, 1e-6, 1e-6) || approxEqual(depY, finalN, 1e-6);
      checks.push({ value: `DepY_SYD=${finalN}`, ok, lhs: depY, rhs: finalN, reason: ok ? null : "SYD dep mismatch" } as any);
    }
  }

  /* ===================== 6) Overhead (POHR) ===================== */
  // POHR = Est OH / Est activity; Applied OH = POHR * actual activity
  const EstOH = findNum(text, new RegExp(`\\b(estimated\\s*overhead|est\\.?\\s*oh)\\s*=\\s*${NUM}`, "i"));
  const EstAct = findNum(text, new RegExp(`\\b(estimated\\s*activity|est\\.?\\s*act(?:ivity)?)\\s*=\\s*${NUM}`, "i"));
  const ActAct = findNum(text, new RegExp(`\\b(actual\\s*activity|act\\.?\\s*act(?:ivity)?)\\s*=\\s*${NUM}`, "i"));
  if ((EstOH != null && EstAct != null) || (EstOH != null && ActAct != null)) {
    const pohr = EstAct ? EstOH / EstAct : null;
    if (/\bpohr\b|predet(?:ermined)?\s*overhead\s*rate/i.test(text) && finalN != null && pohr != null) {
      const ok = relClose(pohr, finalN, 1e-6, 1e-6) || approxEqual(pohr, finalN, 1e-6);
      checks.push({ value: `POHR=${finalN}`, ok, lhs: pohr, rhs: finalN, reason: ok ? null : "POHR mismatch" } as any);
    }
    if (/\bapplied\s*overhead\b/i.test(text) && finalN != null && pohr != null && ActAct != null) {
      const applied = pohr * ActAct;
      const ok = relClose(applied, finalN, 1e-6, 1e-6) || approxEqual(applied, finalN, 1e-6);
      checks.push({ value: `AppliedOH=${finalN}`, ok, lhs: applied, rhs: finalN, reason: ok ? null : "Applied OH mismatch" } as any);
    }
  }

  /* ===================== verdict ===================== */
  if (!checks.length) return null;
  const allVerified = checks.every((c: any) => c.ok);
  return { subject: "accounting", method: "accounting-basic", allVerified, checks } as unknown as Verification;
}
