// lib/verify/index.ts
import type { BoardUnderstanding, Verification } from "@/lib/types";
import { gatherProblemText } from "./utils";

import { verifyAlgebra } from "./algebra";
import { verifyStats } from "./stats";
import { verifyGeometry } from "./geometry";
import { verifyCalculus } from "./calculus";
import { verifyPhysics } from "./physics";
import { verifyChemistry } from "./chemistry";
import { verifyFinance } from "./finance";
import { verifyHeat } from "./heat";
import { verifyAC } from "./circuits_ac";
import { verifyStatics } from "./statics";
import { verifyMaterials } from "./materials"; // mechanics of materials
import { verifyFluids } from "./fluids";
import { verifyAccounting } from "./accounting";
import { verifyProbability } from "./probability";
import { verifyLinearAlgebra } from "./linear_algebra";
import { verifyUnits } from "./units";

type Plugin = {
  name: string;
  matches: (r: BoardUnderstanding, blob: string) => boolean;
  run: (r: BoardUnderstanding) => Verification | null;
};

// Order matters: more specific / math-heavy first; cross-cutting "units" last
const plugins: Plugin[] = [
  {
    name: "algebra",
    matches: (r, blob) =>
      r.type?.startsWith("PROBLEM") === true &&
      (blob.includes("=") ||
        (r.steps || []).some(
          (s) =>
            (s.before || "").includes("=") ||
            (s.after || "").includes("=")
        )),
    run: verifyAlgebra,
  },
  {
    name: "linear-algebra",
    matches: (_r, blob) =>
      /\b(matrix|matrices|det|determinant|inverse|rank|eigenvalue|eigs?|ax\s*=\s*b|linear\s*system|dot\s*product|cross\s*product|projection|norm)\b/i.test(
        blob
      ),
    run: verifyLinearAlgebra,
  },
  {
    name: "calculus",
    matches: (_r, blob) =>
      /\b(derivative|integral|limit|d\/dx)\b|[∫]|(?:\blim\b)/i.test(blob),
    run: verifyCalculus,
  },
  {
    name: "stats",
    matches: (_r, blob) =>
      /\b(mean|average|median|variance|std|standard deviation|sd)\b/i.test(
        blob
      ),
    run: verifyStats,
  },
  {
    name: "probability",
    matches: (_r, blob) =>
      /\b(combination|permutation|choose|ncr|npr|binomial|bernoulli|poisson|normal|gaussian|z[-\s]*score|t[-\s]*score|confidence\s*interval|margin\s*of\s*error|sample\s*size|alpha|significance|p[-\s]*value)\b/i.test(
        blob
      ) || /x\s*~\s*(bin|pois|n|normal|t)\b/i.test(blob),
    run: verifyProbability,
  },
  {
    name: "geometry",
    matches: (_r, blob) =>
      /\b(triangle|rectangle|circle|hypotenuse|pythagorean|perimeter|area|circumference)\b/i.test(
        blob
      ),
    run: verifyGeometry,
  },
  {
    name: "physics",
    matches: (_r, blob) =>
      /\b(kinematics|acceleration|displacement)\b/i.test(blob) ||
      /(v=u\+at|s=ut\+|v\^?2=u\^?2\+2as|\bu=|\bv=|\ba=|\bt=|\bs=)/i.test(blob),
    run: verifyPhysics,
  },
  {
    name: "finance",
    matches: (_r, blob) =>
      /\b(npv|irr|pmt|net present value|internal rate of return|compound annual growth rate|cagr|annuity|present\s*value|future\s*value)\b/i.test(
        blob
      ),
    run: verifyFinance,
  },
  {
    name: "accounting",
    matches: (_r, blob) =>
      /\b(assets?|liabilit(?:y|ies)|equity|journal|debit|credit|cogs|inventory|fifo|lifo|weighted\s*average|depreciation|straight\s*line|double\s*declining|units\s*of\s*production|current\s*ratio|quick\s*ratio|gross\s*margin|roe|roa|debt[-\s]*to[-\s]*equity|break[-\s]*even|contribution\s*margin|cvp)\b/i.test(
        blob
      ),
    run: verifyAccounting,
  },
  {
    name: "chemistry",
    matches: (_r, blob) =>
      /\b(H2O|NaCl|balance|stoichiometry|moles|molarity|dilution|PV\s*=\s*nRT|gas law)\b/i.test(
        blob
      ),
    run: verifyChemistry,
  },
  {
    name: "statics",
    matches: (_r, blob) =>
      /\b(∑F=0|sum\s*of\s*forces|equilibrium|support\s*reactions|free\s*body\s*diagram|fbd|∑M=0|moments?|torque|pin|roller|two[-\s]*force\s*member)\b/i.test(
        blob
      ),
    run: verifyStatics,
  },
  {
    name: "materials",
    matches: (_r, blob) =>
      /\b(stress|strain|young'?s?\s*modulus|poisson'?s?\s*ratio|torsion|shear|bending|beam|moment\s*of\s*inertia|section\s*modulus|deflection|sigma|τ|yield|ultimate)\b/i.test(
        blob
      ),
    run: verifyMaterials,
  },
  {
    name: "fluids",
    matches: (_r, blob) =>
      /\b(reynolds|re\s*=|bernoulli|continuity|head\s*loss|friction\s*factor|darcy|hazen[-\s]*williams|viscosity|flow\s*rate|pump\s*power|manometer|npsh)\b/i.test(
        blob
      ),
    run: verifyFluids,
  },
  {
    name: "heat",
    matches: (_r, blob) =>
      /\b(conduction|convection|radiation|stefan|emissivity|thermal\s*resistance|composite\s*wall|cylindrical|pipe|fin|fins|heat\s*rate|heat\s*flux|q\s*=)\b/i.test(
        blob
      ),
    run: verifyHeat,
  },
  {
    name: "circuits-ac",
    matches: (_r, blob) =>
      /\b(phasor|ac|impedance|reactance|power\s*factor|apparent|reactive|real\s*power|cutoff|corner|-3db|resonance|resonant|rc|rl|rlc)\b/i.test(
        blob
      ) || /j\w|ω|omega\b/i.test(blob),
    run: verifyAC,
  },
  {
    name: "units",
    matches: (_r, blob) =>
      /[A-Za-z°Ωµμu]\s*(?:\/|\*|·|⋅|\^|\d)|\b(N|Pa|J|W|V|A|F|H|Hz|ohm|Ω|kPa|MPa|psi|atm|bar|m\/s|m\^2|m\^3|°C|°F|K)\b/i.test(
        blob
      ) ||
      /\b(force|pressure|energy|power|voltage|current|resistance|capacitance|inductance|frequency|speed|velocity|acceleration|area|volume|density|flow\s*rate|modulus|heat\s*flux)\b/i.test(
        blob
      ),
    run: verifyUnits,
  },
];

export async function verifyBoard(
  result: BoardUnderstanding
): Promise<Verification | null> {
  if (!result || !result.type || !result.type.startsWith("PROBLEM")) return null;

  const blob = gatherProblemText(
    result.question,
    result.raw_text,
    result.steps
  ).toLowerCase();

  for (const p of plugins) {
    try {
      if (p.matches(result, blob)) {
        const v = p.run(result);
        if (v) return v;
      }
    } catch {
      // plugin failed; move on
    }
  }
  return null;
}





