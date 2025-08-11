import { NextRequest } from "next/server";
import { BoardUnderstanding } from "@/lib/types";

export const runtime = "nodejs";

const TZ = "America/Chicago"; // normalize dates from board text

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("image") as unknown as File | null;
    if (!file) return new Response(JSON.stringify({ error: "No image provided" }), { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const b64 = buf.toString("base64");
    const mime = file.type || "image/jpeg";

    const system =
      `You are a tutor + organizer. Your job:
1) Read the whiteboard/worksheet photo.
2) Classify it: PROBLEM_UNSOLVED, PROBLEM_SOLVED, ANNOUNCEMENT, or UNKNOWN.
3) Return STRICT JSON per the provided schema. NEVER include extra commentary.

Rules:
- For math/science problems, give short, numbered steps (no inner reasoning). Keep steps atomic and easy to follow.
- If the board shows a worked solution, re-derive it in your own concise steps and set answer_status:
  * "matches" if your final equals the board's final;
  * "mismatch" if different (then your 'final' is the corrected one);
  * "no_answer_on_board" if no final number/statement is shown.
- For announcements like "Test Friday" or "HW due Wed", produce events[] with ISO 8601 in ${TZ}. If no time given, default start 09:00 local.
- Keep responses brief and readable for a phone screen.`;

    const userContent = [
      { type: "text", text: "Analyze the image and fill the schema." },
      { type: "text", text: `Timezone for dates: ${TZ}` },
      { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
    ];

    const body = {
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: userContent as any
        }
      ]
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const err = await r.text();
      return new Response(JSON.stringify({ error: err }), { status: r.status });
    }

    const data = await r.json();
    const jsonText = data?.choices?.[0]?.message?.content ?? "{}";
    // Minimal validation to avoid crashing UI
    const parsed = JSON.parse(jsonText) as BoardUnderstanding;

    // Clamp confidence
    if (typeof parsed.confidence === "number") {
      parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
    }

    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Failed" }), { status: 500 });
  }
}
