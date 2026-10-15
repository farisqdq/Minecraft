/**
 * Turns the SMS Backup & Restore XML (what the app writes) into conversations
 * the texts viewer can render. No XML library: the app escapes every quote in
 * a value, so each <sms .../> element's attributes parse cleanly by regex.
 */

export type Attachment = { path: string; ct: string; name?: string };
export type SmsMessage = {
  dir: "in" | "out";
  body: string;
  date: number;
  /** Picture-message photos/videos/audio, as paths in the phone's backup (Texts/media/…). */
  attachments?: Attachment[];
  /** Who sent it, for incoming group messages. */
  from?: string;
};
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

const digits = (a: string) => a.replace(/[^\d+]/g, "") || a;
// Last 10 digits, so +1 (859) 555-1234 and 8595551234 are the same person.
const norm = (a: string) => { const d = a.replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : d || a; };

export function parseSmsXml(xml: string): Conversation[] {
  const byKey = new Map<string, Conversation>();
  const convo = (key: string, name: string, address: string) => {
    let c = byKey.get(key);
    if (!c) {
      c = { key, name: name && name !== "(Unknown)" ? name : address, address, count: 0, lastDate: 0, messages: [] };
      byKey.set(key, c);
    }
    if (c.name === c.address && name && name !== "(Unknown)") c.name = name;
    return c;
  };
  const re = /<sms\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const el = m[0];
    const address = attr(el, "address") || "(Unknown)";
    const type = attr(el, "type"); // 1 = received, 2 = sent
    const body = attr(el, "body");
    const date = Number(attr(el, "date")) || 0;
    const name = attr(el, "contact_name") || address;
    // Group by the number, so formatting differences don't split a thread.
    const key = norm(address);
    const c = convo(key, name, address);
    c.count++;
    if (date > c.lastDate) c.lastDate = date;
    if (c.messages.length < MAX_PER_CONVO) {
      c.messages.push({ dir: type === "2" ? "out" : "in", body, date });
    }
  }
  parseMms(xml, convo);

  const convos = Array.from(byKey.values());
  for (const c of convos) c.messages.sort((a, b) => a.date - b.date);
  convos.sort((a, b) => b.lastDate - a.lastDate);
  return convos;
}

/**
 * Picture and group messages (<mms> blocks). A 1-to-1 MMS joins the same
 * thread as that person's SMS; a group gets its own thread keyed by everyone
 * in it. The phone's own number is worked out as the address that receives
 * the most incoming MMS, and left out of thread members.
 */
function parseMms(xml: string, convo: (key: string, name: string, address: string) => Conversation) {
  type Addr = { address: string; type: string; name: string };
  const blocks: { head: string; addrs: Addr[]; parts: string[] }[] = [];
  const re = /<mms\b([^>]*)>([\s\S]*?)<\/mms>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const inner = m[2];
    const addrs = (inner.match(/<addr\b[^>]*\/>/g) || []).map((a) => ({
      address: attr(a, "address"), type: attr(a, "type"), name: attr(a, "name"),
    }));
    blocks.push({ head: m[1], addrs, parts: inner.match(/<part\b[^>]*\/>/g) || [] });
  }
  if (blocks.length === 0) return;

  // Which address is this phone? The one most often on the "to" line of incoming messages.
  const tally = new Map<string, number>();
  for (const b of blocks) {
    if (attr(b.head, "msg_box") !== "1") continue;
    for (const a of b.addrs) if (a.type === "151") tally.set(norm(a.address), (tally.get(norm(a.address)) || 0) + 1);
  }
  let self = "";
  let best = 0;
  tally.forEach((n, k) => { if (n > best) { best = n; self = k; } });

  for (const b of blocks) {
    const out = attr(b.head, "msg_box") === "2";
    const date = Number(attr(b.head, "date")) || 0;
    const fromA = b.addrs.find((a) => a.type === "137");
    const people = new Map<string, Addr>();
    for (const a of b.addrs) {
      const k = norm(a.address);
      if (!k || k === self) continue;
      if (out && a.type === "137") continue; // that's us sending
      if (!people.has(k)) people.set(k, a);
    }
    if (people.size === 0) continue;
    const members = Array.from(people.entries()).sort(([x], [y]) => (x < y ? -1 : 1));
    const key = members.map(([k]) => k).join(",");
    const label = (a: Addr) => (a.name && a.name !== "(Unknown)" ? a.name : a.address);
    const name = members.map(([, a]) => label(a)).join(", ");
    const address = members.map(([, a]) => a.address).join(", ");
    const c = convo(key, name, address);

    let body = "";
    const attachments: Attachment[] = [];
    for (const p of b.parts) {
      const text = attr(p, "text");
      const src = attr(p, "src");
      if (text) body += (body ? "\n" : "") + text;
      if (src) attachments.push({ path: `Texts/${src}`, ct: attr(p, "ct"), name: attr(p, "name") || undefined });
    }
    c.count++;
    if (date > c.lastDate) c.lastDate = date;
    if (c.messages.length < MAX_PER_CONVO) {
      const msg: SmsMessage = { dir: out ? "out" : "in", body, date };
      if (attachments.length) msg.attachments = attachments;
      if (!out && members.length > 1 && fromA) msg.from = label(fromA);
      c.messages.push(msg);
    }
  }
}
