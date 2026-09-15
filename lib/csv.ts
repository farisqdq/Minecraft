/** Quotes a field only when it needs it — keeps simple numbers and dates readable. */
export function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(",") + "\r\n";
}
