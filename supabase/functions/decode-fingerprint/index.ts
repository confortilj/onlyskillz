// skillz.ai — universal fingerprint decoder v3 (ADMIN): + MP4 video
// NOTE: ⁠ ​ ‌ are placeholders for U+2060/200B/200C, substituted at build.
import { createClient } from "jsr:@supabase/supabase-js@2";
const dec = new TextDecoder();
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-admin-key, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const fromBits = (bits: string) => { const by = bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []; try { return dec.decode(new Uint8Array(by)); } catch { return ""; } };
const latin1 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const SYNC = "1010110010110100";

function deText(text: string): string[] { const out: string[] = []; const re = /⁠([​‌]+)⁠/g; let m;
  while ((m = re.exec(text)) !== null) { const d = fromBits([...m[1]].map((c) => (c === "​" ? "0" : "1")).join("")); if (d.startsWith("SKZFP1.")) out.push(d); } return [...new Set(out)]; }
function deCanary(text: string): string[] { const m = text.match(/CN[A-Z0-9]{4,8}[a-f0-9]{8}/); return m ? [m[0]] : []; }
function deAudio(bytes: Uint8Array): string[] {
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "RIFF") return [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const total = (bytes.length - 44) / 2; const off = 100; let bits = "";
  for (let i = 0; i < total - off; i++) bits += (dv.getInt16(44 + (off + i) * 2, true) & 1);
  const start = bits.indexOf(SYNC); if (start < 0) return []; const after = bits.slice(start + SYNC.length); const end = after.indexOf(SYNC); if (end < 0) return [];
  const d = fromBits(after.slice(0, end)); return d.startsWith("SKZFP1.") ? [d] : []; }
function deModel(bytes: Uint8Array): string[] { try { const len = Number(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true)); const h = JSON.parse(dec.decode(bytes.slice(8, 8 + len))); const fp = h.__metadata__?.skillz_fingerprint; return fp?.startsWith("SKZFP1.") ? [fp] : []; } catch { return []; } }
function deVideo(bytes: Uint8Array): string[] {
  const full = latin1(bytes);
  const idx = full.indexOf("skzf"); if (idx >= 0) { const js = full.indexOf("{", idx); const je = full.indexOf("}", js); if (js >= 0 && je >= 0) { try { const fp = JSON.parse(full.slice(js, je + 1)).skillz_fingerprint; if (fp?.startsWith("SKZFP1.")) return [fp]; } catch { /* */ } } }
  const fi = full.indexOf("SKZVID:"); if (fi >= 0) { const after = full.slice(fi + 7); const end = after.indexOf("\0"); const code = after.slice(0, end < 0 ? 24 : end); if (code.startsWith("SKZFP1.")) return [code]; }
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const adminKey = Deno.env.get("ADMIN_API_KEY");
  if (!adminKey || req.headers.get("x-admin-key") !== adminKey) return json({ error: "Unauthorized" }, 401);
  try {
    const body = await req.json(); let bytes: Uint8Array | null = null; let text = body.text ?? "";
    if (body.base64) { const bin = atob(body.base64); bytes = new Uint8Array([...bin].map((c) => c.charCodeAt(0))); if (!text) try { text = dec.decode(bytes); } catch { /* */ } }
    let codes: string[] = []; let kind = ""; let format = "";
    if (bytes && (codes = deVideo(bytes)).length) { kind = "fingerprint"; format = "mp4-video"; }
    else if (bytes && (codes = deAudio(bytes)).length) { kind = "fingerprint"; format = "wav-audio"; }
    else if (bytes && (codes = deModel(bytes)).length) { kind = "fingerprint"; format = "safetensors"; }
    else if ((codes = deText(text)).length) { kind = "fingerprint"; format = text.includes("<svg") ? "svg" : "text"; }
    else if ((codes = deCanary(text)).length) { kind = "canary"; format = "dataset"; }
    if (!codes.length) return json({ found: false, message: "No skillz.ai fingerprint or canary detected." });
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const results = [];
    for (const code of codes) {
      let fpRow = null;
      if (kind === "canary") { const { data: can } = await admin.from("canaries").select("fingerprint_code").eq("canary_signature", code).maybeSingle(); if (can) { const { data: fp } = await admin.from("fingerprints").select("*").eq("fingerprint_code", can.fingerprint_code).maybeSingle(); fpRow = fp; } }
      else { const { data: fp } = await admin.from("fingerprints").select("*").eq("fingerprint_code", code).maybeSingle(); fpRow = fp; }
      if (!fpRow) { results.push({ marker: code, kind, registered: false }); continue; }
      const { data: prof } = await admin.from("profiles").select("display_name, handle, plan").eq("id", fpRow.user_id).single();
      const { data: lic } = await admin.from("licenses").select("license_key, kind, status, created_at").eq("id", fpRow.license_id).maybeSingle();
      results.push({ marker: code, kind, format: fpRow.artifact_format, method: fpRow.method, account: prof, license: lic, issued_at: fpRow.issued_at, ip_address: fpRow.ip_address, user_agent: fpRow.user_agent, artifact_sha256: fpRow.artifact_sha256, product_id: fpRow.product_id });
    }
    return json({ found: true, detected_format: format, matches: results, evidence_note: "Registry rows include issuance timestamp, IP, and user agent. Export with artifact SHA-256 for the legal evidence package." });
  } catch (e) { return json({ error: String(e) }, 500); }
});
