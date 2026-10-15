/** Parses a .vcf (vCard) file into a simple contact list for the viewer. */
export type Contact = { name: string; phones: string[]; emails: string[] };

function unfold(vcf: string): string {
  // vCard continues a long line when the next starts with a space or tab.
  return vcf.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

export function parseVcf(vcf: string, limit = 20000): Contact[] {
  const out: Contact[] = [];
  const cards = unfold(vcf).split(/BEGIN:VCARD/i).slice(1);
  for (const card of cards) {
    if (out.length >= limit) break;
    let name = "";
    const phones: string[] = [];
    const emails: string[] = [];
    let nField = "";
    for (const raw of card.split("\n")) {
      const line = raw.trim();
      if (!line || /^END:VCARD/i.test(line)) continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const prop = line.slice(0, colon).toUpperCase();
      const value = line.slice(colon + 1).trim();
      if (prop === "FN" || prop.startsWith("FN;")) name = value.replace(/\\,/g, ",").replace(/\;/g, ";");
      else if (prop === "N" || prop.startsWith("N;")) nField = value.replace(/;/g, " ").trim();
      else if (prop === "TEL" || prop.startsWith("TEL;")) { if (value) phones.push(value); }
      else if (prop === "EMAIL" || prop.startsWith("EMAIL;")) { if (value) emails.push(value); }
    }
    const finalName = name || nField || phones[0] || "(No name)";
    if (phones.length || emails.length || name || nField) {
      out.push({ name: finalName, phones: Array.from(new Set(phones)), emails: Array.from(new Set(emails)) });
    }
  }
  out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return out;
}
