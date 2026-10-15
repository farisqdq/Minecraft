/** Parses the call-log XML (SMS Backup & Restore "calls" format) for the viewer. */
export type Call = {
  dir: "in" | "out" | "missed" | "rejected" | "blocked" | "voicemail" | "other";
  name: string;
  number: string;
  duration: number; // seconds
  date: number; // epoch ms
};

function unescape(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function attr(el: string, name: string): string {
  const m = el.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? unescape(m[1]) : "";
}
const TYPE: Record<string, Call["dir"]> = { "1": "in", "2": "out", "3": "missed", "4": "voicemail", "5": "rejected", "6": "blocked" };

export function parseCallsXml(xml: string, limit = 5000): Call[] {
  const out: Call[] = [];
  const re = /<call\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && out.length < limit) {
    const el = m[0];
    const number = attr(el, "number") || "(Unknown)";
    const name = attr(el, "contact_name") || number;
    out.push({
      dir: TYPE[attr(el, "type")] || "other",
      name: name && name !== "(Unknown)" ? name : number,
      number,
      duration: Number(attr(el, "duration")) || 0,
      date: Number(attr(el, "date")) || 0,
    });
  }
  out.sort((a, b) => b.date - a.date);
  return out;
}
