// skillz.ai — submit-product v3: real file uploads + seller pricing + rate limiting + deep scan
// Pricing v2: skills ⬡5, prompts ⬡2, workflows ⬡30 (auto). Datasets: small ⬡15 / medium ⬡30 / large+xl seller-$.
// Avatars & voices: personal ⬡60 + optional commercial seller-$. Models/rag/eval/assets: seller-$ (0 = free).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { deepScan } from "./scanner.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const rand = (n: number) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join(""); };
const SUMMARY: Record<string, string> = { critical: "fail", high: "fail", medium: "warn", low: "warn" };

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB MVP cap
const TEXT_EXTS = ["md", "csv", "jsonl", "svg", "txt"];
const FILE_RULES: Record<string, string[]> = {
  skill: ["md", "zip"], prompt: ["md", "zip"], workflow: ["md", "zip"],
  dataset: ["csv", "jsonl", "zip"], rag: ["csv", "jsonl", "zip"],
  model: ["safetensors", "gguf"], voice: ["wav", "mp3"], avatar: ["mp4", "zip"],
  eval: ["md", "jsonl", "zip"], assets: ["zip", "svg"],
};
function magicOk(ext: string, b: Uint8Array): boolean {
  const ascii = (o: number, s: string) => [...s].every((c, i) => b[o + i] === c.charCodeAt(0));
  switch (ext) {
    case "zip": return ascii(0, "PK");
    case "wav": return ascii(0, "RIFF");
    case "mp3": return ascii(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
    case "mp4": return ascii(4, "ftyp");
    case "gguf": return ascii(0, "GGUF");
    case "safetensors": { const dv = new DataView(b.buffer, b.byteOffset); const len = Number(dv.getBigUint64(0, true)); return len > 0 && len < b.length && b[8] === 0x7b; }
    case "svg": return new TextDecoder().decode(b.slice(0, 512)).includes("<svg");
    default: return true; // text formats validated as utf-8 below
  }
}
function b64ToBytes(s: string): Uint8Array { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }

// server-side pricing resolution — the client never sets credit prices for auto-priced types
function resolvePricing(type: string, size_tier: string | null, price_usd_cents: number | null):
  { credits_price: number | null; price_usd_cents: number | null; size_tier: string | null; error?: string } {
  const usd = Number.isFinite(price_usd_cents as number) && (price_usd_cents as number) >= 0 ? Math.round(price_usd_cents as number) : null;
  if (type === "skill") return { credits_price: 5, price_usd_cents: null, size_tier: null };
  if (type === "prompt") return { credits_price: 2, price_usd_cents: null, size_tier: null };
  if (type === "workflow") return { credits_price: 30, price_usd_cents: null, size_tier: null };
  if (type === "dataset") {
    if (!["small", "medium", "large", "xl"].includes(size_tier ?? "")) return { credits_price: null, price_usd_cents: null, size_tier: null, error: "dataset size_tier required: small | medium | large | xl" };
    if (size_tier === "small") return { credits_price: 15, price_usd_cents: null, size_tier };
    if (size_tier === "medium") return { credits_price: 30, price_usd_cents: null, size_tier };
    if (!usd || usd <= 0) return { credits_price: null, price_usd_cents: null, size_tier, error: "large/xl datasets need a dollar price (price_usd_cents > 0)" };
    return { credits_price: null, price_usd_cents: usd, size_tier };
  }
  if (type === "avatar" || type === "voice") return { credits_price: 60, price_usd_cents: usd && usd > 0 ? usd : null, size_tier: null };
  if (["model", "rag", "eval", "assets"].includes(type)) return { credits_price: null, price_usd_cents: usd ?? 0, size_tier: null }; // 0 = free
  return { credits_price: null, price_usd_cents: null, size_tier: null, error: `unsupported product type: ${type}` };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supaUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization")! } } });
    const admin = createClient(supaUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    // ---- rate limit: max 5 submissions per hour ----
    const hourAgo = new Date(Date.now() - 3600e3).toISOString();
    const { count: recent } = await admin.from("scan_reports").select("id", { count: "exact", head: true }).eq("submitted_by", user.id).gte("created_at", hourAgo);
    if ((recent ?? 0) >= 5) return json({ error: "Rate limit: max 5 submissions per hour. Try again later." }, 429);

    const body = await req.json();
    const { name, type = "skill", category = "Productivity", version = "1.0.0", description = "", docs_markdown = "", llms = [], size_tier = null, price_usd_cents = null, file = null } = body;
    if (!name) return json({ error: "name required" }, 400);
    if (type === "mcp") return json({ error: "MCP connectors are no longer accepted on the marketplace" }, 400);
    const pricing = resolvePricing(type, size_tier, price_usd_cents);
    if (pricing.error) return json({ error: pricing.error }, 400);

    // ---- optional real product file: validate extension, size, magic bytes ----
    let fileBytes: Uint8Array | null = null; let fileExt = ""; let fileName = "";
    if (file?.base64 && file?.name) {
      fileExt = String(file.name).split(".").pop()!.toLowerCase();
      const allowed = FILE_RULES[type] ?? [];
      if (!allowed.includes(fileExt)) return json({ error: `Invalid file type ".${fileExt}" for a ${type} — accepted: ${allowed.map((e) => "." + e).join(", ")}` }, 400);
      try { fileBytes = b64ToBytes(file.base64); } catch { return json({ error: "file.base64 is not valid base64" }, 400); }
      if (fileBytes.length > MAX_BYTES) return json({ error: `File too large: ${(fileBytes.length / 1048576).toFixed(1)} MB (max 10 MB)` }, 413);
      if (fileBytes.length < 8) return json({ error: "File is empty or truncated" }, 400);
      if (!magicOk(fileExt, fileBytes)) return json({ error: `File contents do not match .${fileExt} format` }, 400);
      if (TEXT_EXTS.includes(fileExt)) { try { new TextDecoder("utf-8", { fatal: true }).decode(fileBytes); } catch { return json({ error: `.${fileExt} file is not valid UTF-8 text` }, 400); } }
      fileName = `product-${rand(4)}.${fileExt}`;
    }

    const { data: profile } = await admin.from("profiles").select("*").eq("id", user.id).single();
    if (!profile?.is_designer) await admin.from("profiles").update({ is_designer: true }).eq("id", user.id);

    // ---- deep static scan: metadata + docs + text file contents ----
    let scanText = `${name}\n${description}\n${docs_markdown}`;
    if (fileBytes && TEXT_EXTS.includes(fileExt)) scanText += "\n" + new TextDecoder().decode(fileBytes).slice(0, 200_000);
    const scan = deepScan(scanText);
    const published = scan.verdict === "published";
    const summaryChecks = (() => {
      const cats = ["malicious-code", "exfiltration", "injection", "secrets", "obfuscation", "permissions", "dependencies"];
      return cats.map((cat) => {
        const hits = scan.findings.filter((f) => f.category === cat);
        const worst = hits.sort((a, b) => ["info", "low", "medium", "high", "critical"].indexOf(b.severity) - ["info", "low", "medium", "high", "critical"].indexOf(a.severity))[0];
        const label = { "malicious-code": "Malicious code", exfiltration: "Data exfiltration", injection: "Hidden injection", secrets: "Credential leakage", obfuscation: "Obfuscation analysis", permissions: "Permission scoping", dependencies: "Dependency audit" }[cat]!;
        if (!worst) return { name: label, status: "pass", note: "No issues detected." };
        return { name: label, status: SUMMARY[worst.severity] ?? "warn", note: `${worst.title} (${worst.cwe}): ${worst.detail}` };
      });
    })();

    const id = `${slugify(name)}-${rand(4)}`;
    const designerLabel = `${profile?.display_name ?? "Designer"} @${profile?.handle ?? "designer"}`;
    // docs always stored; the real product file (if given) becomes the bundle
    await admin.storage.from("bundles").upload(`${id}/SKILL.md`, new Blob([docs_markdown || description], { type: "text/markdown" }), { upsert: true });
    let bundlePath = `${id}/SKILL.md`;
    if (fileBytes) {
      const { error: upErr } = await admin.storage.from("bundles").upload(`${id}/${fileName}`, new Blob([fileBytes]), { upsert: true, contentType: "application/octet-stream" });
      if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);
      bundlePath = `${id}/${fileName}`;
    }

    const { error: insErr } = await admin.from("products").insert({
      id, type, name, icon: body.icon ?? "🧩", description, category, tier: "pro", version, designer_id: user.id, designer_label: designerLabel,
      llms, score: scan.score, rating: null, upvotes: 0, downloads: 0, featured: false, trend_rank: 999,
      credits_price: pricing.credits_price, price_usd_cents: pricing.price_usd_cents, size_tier: pricing.size_tier,
      docs: { overview: description, usage: docs_markdown ? docs_markdown.slice(0, 2000) : "Documentation pending.", install: "Purchase on skillz.ai — your licensed, watermarked copy downloads instantly from this page.", examples: [] },
      security: { scanned: new Date().toISOString().slice(0, 10), checks: summaryChecks },
      bundle_path: bundlePath, published,
    });
    if (insErr) return json({ error: insErr.message }, 500);

    await admin.from("scan_reports").insert({ product_id: id, submitted_by: user.id, score: scan.score, verdict: scan.verdict, findings: scan.findings, dynamic_scan_status: published ? "queued" : "skipped", engine_version: "static-2.0" });

    const msg = scan.verdict === "published" ? `Published — score ${scan.score}/100${scan.score >= 90 ? " · Verified Safe badge" : ""}. Dynamic sandbox scan queued.`
      : scan.verdict === "needs_review" ? `Score ${scan.score}/100 — flagged for manual review before publishing (sensitive findings present).`
      : `Score ${scan.score}/100 — BLOCKED. Critical issues must be resolved before resubmitting.`;
    return json({ ok: true, product_id: id, published, verdict: scan.verdict, has_file: !!fileBytes, pricing, scan: { score: scan.score, verdict: scan.verdict, findings: scan.findings, checks: summaryChecks }, message: msg });
  } catch (e) { return json({ error: String(e) }, 500); }
});
