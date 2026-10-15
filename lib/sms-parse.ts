/**
 * Turns the SMS Backup & Restore XML (what the app writes) into conversations
 * the texts viewer can render. No XML library: the app escapes every quote in
 * a value, so each <sms .../> element's attributes parse cleanly by regex.
 */

export type SmsMessage = { dir: "in" | "out"; body: string; date: number };
export type Conversation = {
  key: string;
  name: string;
  address: string;
  count: number;
  lastDate: number;
  messages: SmsMessage[];
};

function unescape(s: string): string {
  return s
    .replace(/&#10;/g, "\n").replace(/&#13;/g, "\r").replace(/&#9;/g, "\t")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attr(el: string, name: string): string {
  const m = el.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? unescape(m[1]) : "";
}

const MAX_PER_CONVO = 2000;

export function parseSmsXml(xml: string): Conversation[] {
  const byKey = new Map<string, Conversation>();
  const re = /<sms\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const el = m[0];
    const address = attr(el, "address") || "(Unknown)";
    const type = attr(el, "type"); // 1 = received, 2 = sent
    const body = attr(el, "body");
    const date = Number(attr(el, "date")) || 0;
    const name = attr(el, "contact_name") || address;
    // Group by digits of the number, so formatting differences don't split a thread.
    const key = address.replace(/[^\d+]/g, "") || address;
    let c = byKey.get(key);
    if (!c) {
      c = { key, name: name && name !== "(Unknown)" ? name : address, address, count: 0, lastDate: 0, messages: [] };
      byKey.set(key, c);
    }
    if (c.name === c.address && name && name !== "(Unknown)") c.name = name;
    c.count++;
    if (date > c.lastDate) c.lastDate = date;
    if (c.messages.length < MAX_PER_CONVO) {
      c.messages.push({ dir: type === "2" ? "out" : "in", body, date });
    }
  }
  const convos = Array.from(byKey.values());
  for (const c of convos) c.messages.sort((a, b) => a.date - b.date);
  convos.sort((a, b) => b.lastDate - a.lastDate);
  return convos;
}
