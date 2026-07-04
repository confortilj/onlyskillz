// skillz.ai — deep static security scanner (engine v2.0)
// NOTE: \u200B \u200C \u200D \u2060 are placeholders for U+200B/200C/200D/2060, substituted at build.
export type Finding = { severity: string; category: string; cwe: string; title: string; detail: string; evidence: string };

function shannon(s: string): number {
  if (!s.length) return 0; const f: Record<string, number> = {};
  for (const c of s) f[c] = (f[c] || 0) + 1;
  return -Object.values(f).reduce((a, n) => { const p = n / s.length; return a + p * Math.log2(p); }, 0);
}
function recursiveDecode(s: string, depth = 0): string {
  let extra = ""; if (depth > 3) return extra;
  for (const m of s.matchAll(/[A-Za-z0-9+/]{40,}={0,2}/g)) {
    try { const d = atob(m[0]); if (/[\x20-\x7e]{8,}/.test(d)) extra += "\n" + d + recursiveDecode(d, depth + 1); } catch { /* */ }
  }
  for (const m of s.matchAll(/(?:\\x[0-9a-fA-F]{2}){8,}/g)) {
    try { const d = m[0].split("\\x").filter(Boolean).map((h) => String.fromCharCode(parseInt(h, 16))).join(""); extra += "\n" + d; } catch { /* */ }
  }
  return extra;
}

export function deepScan(content: string): { score: number; verdict: string; findings: Finding[] } {
  const findings: Finding[] = []; let score = 100;
  const add = (severity: string, category: string, cwe: string, title: string, detail: string, evidence: string) => {
    findings.push({ severity, category, cwe, title, detail, evidence });
    score -= severity === "critical" ? 40 : severity === "high" ? 25 : severity === "medium" ? 12 : severity === "low" ? 5 : 0;
  };
  const decoded = recursiveDecode(content); const all = content + decoded;
  if (decoded.trim()) add("high", "obfuscation", "CWE-506", "Hidden encoded payload", "Base64/hex content decoded and scanned recursively.", decoded.trim().slice(0, 80));
  const longTokens = all.split(/\s+/).filter((t) => t.length > 40);
  const highEnt = longTokens.filter((t) => shannon(t) > 4.5);
  if (highEnt.length > 2) add("medium", "obfuscation", "CWE-506", "High-entropy tokens", `${highEnt.length} high-entropy tokens suggest packing/obfuscation.`, highEnt[0].slice(0, 40) + "…");
  const danger: [RegExp, string, string, string, string][] = [
    [/\beval\s*\(|\bnew\s+Function\s*\(/, "critical", "CWE-95", "Dynamic code execution", "eval/Function() executes arbitrary code"],
    [/child_process|subprocess|os\.system|Runtime\.exec|popen/, "critical", "CWE-78", "OS command execution", "spawns shell/processes"],
    [/\brm\s+-rf|\bdel\s+\/[fsq]|format\s+c:|mkfs/, "critical", "CWE-78", "Destructive command", "irreversible deletion command"],
    [/powershell\s+-(enc|e|nop)|certutil\s+-decode|bitsadmin/i, "critical", "CWE-78", "LOLBins / encoded shell", "living-off-the-land binary abuse"],
    [/document\.cookie|localStorage|sessionStorage/, "medium", "CWE-312", "Client storage access", "reads browser storage"],
  ];
  for (const [re, sev, cwe, title, detail] of danger) { const m = all.match(re); if (m) add(sev, "malicious-code", cwe, title, detail, m[0]); }
  const hosts = [...all.matchAll(/https?:\/\/([\w.-]+)/g)].map((m) => m[1]).filter((h) => !["github.com", "skillz.ai", "docs.skillz.ai", "raw.githubusercontent.com"].includes(h));
  const sinks = /fetch\s*\(|XMLHttpRequest|requests\.(post|get)|urllib|axios|curl\s+http|net\.connect|new\s+WebSocket/i.test(all);
  const ipLit = /\b\d{1,3}(\.\d{1,3}){3}\b/.test(all);
  if (sinks && (hosts.length || ipLit)) add("critical", "exfiltration", "CWE-200", "Data exfiltration vector", `Network call to external destination${hosts[0] ? ": " + hosts[0] : " (raw IP)"}.`, hosts[0] || "raw IP");
  else if (sinks || hosts.length) add("low", "network", "CWE-200", "Network reference", "External URL or network syntax present.", hosts[0] || "network call");
  const secrets: [RegExp, string][] = [[/AKIA[0-9A-Z]{16}/, "AWS access key"], [/sk-[A-Za-z0-9]{20,}/, "API secret key"], [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, "private key"], [/ghp_[A-Za-z0-9]{36}/, "GitHub token"], [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"]];
  let hasSecret = false;
  for (const [re, what] of secrets) { if (re.test(all)) { add("high", "secrets", "CWE-798", "Hardcoded credential", `Embedded ${what} detected.`, what); hasSecret = true; } }
  if (/[\u200B\u200C\u200D\u2060]/.test(content)) add("high", "injection", "CWE-94", "Zero-width payload", "Invisible characters may carry hidden instructions.", "zero-width chars");
  if (/ignore\s+(all\s+)?(previous|prior)\s+instructions|disregard\s+your\s+system\s+prompt|you\s+are\s+now\s+DAN/i.test(all)) add("high", "injection", "CWE-94", "Prompt-injection phrasing", "Attempts to override the host model's instructions.", "override phrasing");
  const perms = [...all.matchAll(/(file[- ]?write|filesystem\s+write|network\s+access|full\s+access|sudo|admin\s+rights|all\s+permissions|read\s+all\s+files)/ig)];
  if (perms.length) add("medium", "permissions", "CWE-250", "Over-broad permissions", `Requests ${perms.length} broad capability(ies).`, perms[0][0]);
  const deps = [...all.matchAll(/(?:require|import)\s*\(?['"]([\w@/.-]+)['"]/g)].map((m) => m[1]).filter((d) => !d.startsWith("."));
  if (deps.length > 8) add("low", "dependencies", "CWE-1104", "Large dependency surface", `${deps.length} imports increase supply-chain risk.`, deps.slice(0, 3).join(", "));

  score = Math.max(score, 0);
  const hasCritical = findings.some((f) => f.severity === "critical");
  const forcesReview = hasSecret || findings.some((f) => f.category === "injection");
  let verdict = score >= 70 ? "published" : score >= 50 ? "needs_review" : "blocked";
  if (hasCritical) verdict = "blocked";
  else if (forcesReview && verdict === "published") verdict = "needs_review";
  return { score, verdict, findings };
}
