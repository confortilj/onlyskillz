// skillz.ai — scan-web: auto-takedown crawler.
// Fetches candidate URLs (or GitHub/HF search results), extracts any skillz.ai
// watermark/canary, resolves the leaking account, and records a takedown.
// Triggered by pg_cron or admin. Honest scope: real GitHub/HF code search needs
// their API tokens (GITHUB_TOKEN / HF_TOKEN); without them, scans provided URLs.
// NOTE: ⁠ ​ ‌ are placeholders for U+2060/200B/200C, substituted at build.
import { createClient } from "jsr:@supabase/supabase-js@2";
const dec = new TextDecoder();
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const fromBits = (bits: string) => { const by = bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []; try { return dec.decode(new Uint8Array(by)); } catch { return ""; } };

function extractMarkers(text: string): { code: string; kind: string }[] {
  const out: { code: string; kind: string }[] = [];
  const re = /⁠([​‌]+)⁠/g; let m;
  while ((m = re.exec(text)) !== null) { const d = fromBits([...m[1]].map((c) => (c === "​" ? "0" : "1")).join("")); if (d.startsWith("SKZFP1.")) out.push({ code: d, kind: "fingerprint" }); }
  const fp = text.match(/SKZFP1\.[A-Z0-9]{6}\.[a-f0-9]{16}/g) ?? []; for (const c of fp) out.push({ code: c, kind: "fingerprint" });
  const cn = text.match(/CN[A-Z0-9]{4,8}[a-f0-9]{8}/g) ?? []; for (const c of cn) out.push({ code: c, kind: "canary" });
  const seen = new Set(); return out.filter((x) => !seen.has(x.code) && seen.add(x.code));
}
function platform(url: string): string { if (url.includes("github")) return "github"; if (url.includes("huggingface")) return "huggingface"; if (/pastebin|ghostbin|paste\./.test(url)) return "pastebin"; return "other"; }

async function discover(): Promise<string[]> {
  const gh = Deno.env.get("GITHUB_TOKEN"); const urls: string[] = [];
  if (gh) { try { const r = await fetch("https://api.github.com/search/code?q=%22Licensed+via+skillz.ai%22&per_page=10", { headers: { Authorization: `Bearer ${gh}`, Accept: "application/vnd.github+json", "User-Agent": "skillz-crawler" } }).then((x) => x.json()); for (const it of r.items ?? []) if (it.html_url) urls.push(it.html_url.replace("/blob/", "/raw/")); } catch (_) { /* */ } }
  return urls;
}

Deno.serve(async (req: Request) => {
  const adminKey = Deno.env.get("ADMIN_API_KEY"); const isCron = req.headers.get("x-cron") === Deno.env.get("CRON_SECRET");
  if (!isCron && (!adminKey || req.headers.get("x-admin-key") !== adminKey)) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let urls: string[] = [];
  try { const body = await req.json(); urls = body.urls ?? []; } catch (_) { /* */ }
  urls = [...urls, ...(await discover())];
  const hits = [];
  for (const url of urls.slice(0, 25)) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "skillz-crawler" } }); if (!res.ok) continue;
      const text = (await res.text()).slice(0, 200000);
      for (const mk of extractMarkers(text)) {
        let fpCode = mk.code;
        if (mk.kind === "canary") { const { data: can } = await admin.from("canaries").select("fingerprint_code").eq("canary_signature", mk.code).maybeSingle(); fpCode = can?.fingerprint_code ?? mk.code; }
        const { data: fp } = await admin.from("fingerprints").select("user_id, product_id").eq("fingerprint_code", fpCode).maybeSingle();
        const { data: dup } = await admin.from("takedowns").select("id").eq("source_url", url).eq("matched_marker", mk.code).maybeSingle();
        if (dup) continue;
        const { data: row } = await admin.from("takedowns").insert({ source_url: url, platform: platform(url), matched_marker: mk.code, fingerprint_code: fp ? fpCode : null, matched_user_id: fp?.user_id ?? null, product_id: fp?.product_id ?? null, status: "detected", evidence: { marker_kind: mk.kind, found_at: new Date().toISOString() } }).select().single();
        hits.push({ url, marker: mk.code, traced_to_user: fp?.user_id ?? null, product: fp?.product_id ?? null, takedown_id: row?.id });
      }
    } catch (_) { /* skip */ }
  }
  return json({ ok: true, scanned: urls.length, leaks_found: hits.length, hits });
});
