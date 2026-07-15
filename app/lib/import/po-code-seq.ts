// app/lib/import/po-code-seq.ts
// Tag-agnostic parsing + batch sequence seeding for PO codes: "<TAG>-<prefix>-<mmyy>-<seq>".
// Shared by client POs (tag "CPO") and partner POs (tag "PPO").

export function parsePoCode(code: string): { tag: string; prefix: string; mmyy: string; seq: number } | null {
  const m = /^([A-Za-z]+)-(.+)-(\d{4})-(\d+)$/.exec(code);
  if (!m) return null;
  return { tag: m[1], prefix: m[2], mmyy: m[3], seq: Number(m[4]) };
}

/** Highest existing sequence per `${prefix}|${mmyy}` among codes carrying the given tag. */
export function seedMaxSeq(codes: string[], tag: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const code of codes) {
    const p = parsePoCode(code);
    if (!p || p.tag !== tag) continue;
    const key = `${p.prefix}|${p.mmyy}`;
    map.set(key, Math.max(map.get(key) ?? 0, p.seq));
  }
  return map;
}
