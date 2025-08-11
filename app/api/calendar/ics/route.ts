import { NextRequest } from "next/server";

// Simple ICS emitter with a 2-day (2880 min) reminder
function makeICS({
  uid,
  title,
  startISO,
  endISO,
  notes
}: {
  uid: string;
  title: string;
  startISO: string;
  endISO?: string | null;
  notes?: string | null;
}) {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const start = startISO.replace(/[-:]/g, "").replace(/\.\d+Z?$/, "") + (startISO.endsWith("Z") ? "" : "");
  const end = endISO
    ? endISO.replace(/[-:]/g, "").replace(/\.\d+Z?$/, "")
    : "";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SCRBL//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `SUMMARY:${title}`,
    `DTSTART:${start}`,
    end ? `DTEND:${end}` : "",
    notes ? `DESCRIPTION:${notes.replace(/\n/g, "\\n")}` : "",
    "BEGIN:VALARM",
    "TRIGGER:-PT2880M", // 2 days prior
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean).join("\r\n");
}

export async function POST(req: NextRequest) {
  try {
    const { title, startISO, endISO = null, notes = "" } = await req.json();
    if (!title || !startISO) {
      return new Response("Missing title/startISO", { status: 400 });
    }
    const ics = makeICS({
      uid: `${Date.now()}@scrbl`,
      title,
      startISO,
      endISO,
      notes
    });
    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="event.ics"`
      }
    });
  } catch (e: any) {
    return new Response(e?.message || "Failed", { status: 500 });
  }
}
