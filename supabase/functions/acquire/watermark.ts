// skillz.ai — multi-format forensic watermark engine (v3: + MP4 video)
// NOTE: \u2060 \u200B \u200C are placeholders for U+2060 / U+200B / U+200C, substituted at build.
const enc = new TextEncoder(); const dec = new TextDecoder();
const toBits = (s: string) => [...enc.encode(s)].map((b) => b.toString(2).padStart(8, "0")).join("");
export type WmResult = { bytes: Uint8Array | null; filename: string; mime: string; method: string; format: string; url?: string; canary?: { signature: string; positions: number[] } };

export function wmText(text: string, code: string): string {
  const mark = "\u2060" + [...toBits(code)].map((b) => (b === "0" ? "\u200B" : "\u200C")).join("") + "\u2060";
  const L = text.split("\n"); const mid = Math.floor(L.length / 2);
  L[0] += mark; if (L.length > 2) { L[mid] += mark; L[L.length - 1] += mark; }
  return L.join("\n");
}
export function wmDataset(code: string, isJsonl: boolean): { content: string; signature: string; positions: number[] } {
  const sig = "CN" + code.split(".")[1] + code.slice(-8);
  const base = isJsonl ? Array.from({ length: 12 }, (_, i) => JSON.stringify({ id: i + 1, text: `example record ${i + 1}`, label: i % 2 ? "A" : "B" }))
    : ["id,text,label", ...Array.from({ length: 11 }, (_, i) => `${i + 1},example record ${i + 1},${i % 2 ? "A" : "B"}`)];
  const positions: number[] = [];
  for (let i = 0; i < 3; i++) { const pos = Math.floor((i + 1) * base.length / 4) + i;
    const canary = isJsonl ? JSON.stringify({ id: `rec_${sig}_${i}`, text: "example record", label: "A", _ref: sig }) : `rec_${sig}_${i},example record,A,${sig}`;
    base.splice(pos, 0, canary); positions.push(pos); }
  return { content: base.join("\n"), signature: sig, positions };
}
const SYNC = "1010110010110100";
function makeWav(samples: number[], rate = 8000): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2); const dv = new DataView(buf);
  const wr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, "RIFF"); dv.setUint32(4, 36 + samples.length * 2, true); wr(8, "WAVE"); wr(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); wr(36, "data"); dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, samples[i], true); return new Uint8Array(buf);
}
export function wmAudio(code: string): Uint8Array {
  const payload = SYNC + toBits(code) + SYNC; const n = Math.max(payload.length + 4000, 8000); const samples = new Array(n);
  for (let i = 0; i < n; i++) samples[i] = Math.round(3000 * Math.sin(2 * Math.PI * 440 * i / 8000));
  const off = 100; for (let i = 0; i < payload.length; i++) samples[off + i] = (samples[off + i] & ~1) | Number(payload[i]); return makeWav(samples);
}
export function wmModel(code: string): Uint8Array {
  const header = { __metadata__: { format: "pt", skillz_fingerprint: code, license: "skillz.ai" }, "weight.0": { dtype: "F32", shape: [4], data_offsets: [0, 16] } };
  const hjson = enc.encode(JSON.stringify(header)); const tensor = new Uint8Array(16); const out = new Uint8Array(8 + hjson.length + tensor.length);
  new DataView(out.buffer).setBigUint64(0, BigInt(hjson.length), true); out.set(hjson, 8); out.set(tensor, 8 + hjson.length); return out;
}
export function wmSvg(code: string): string {
  const mark = "\u2060" + [...toBits(code)].map((b) => (b === "0" ? "\u200B" : "\u200C")).join("") + "\u2060";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><metadata>skillz.ai licensed asset</metadata><desc>${mark}</desc><rect width="64" height="64" fill="#8b6cff"/></svg>`;
}
function u32(n: number) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
function atom(type: string, body: Uint8Array) { return new Uint8Array([...u32(8 + body.length), ...enc.encode(type), ...body]); }
export function wmVideo(code: string, frames = 24): Uint8Array {
  const skzf = atom("skzf", enc.encode(JSON.stringify({ skillz_fingerprint: code, license: "skillz.ai" })));
  const udta = atom("udta", atom("meta", skzf));
  const ftyp = atom("ftyp", new Uint8Array([...enc.encode("isom"), 0, 0, 2, 0, ...enc.encode("mp41isom")]));
  const SYNCV = enc.encode("SKZVID:"); const codeBytes = enc.encode(code); const blocks: Uint8Array[] = [];
  for (let i = 0; i < frames; i++) { const filler = new Uint8Array(40); crypto.getRandomValues(filler); blocks.push(new Uint8Array([...SYNCV, ...codeBytes, 0, ...filler])); }
  let body = new Uint8Array(blocks.reduce((a, b) => a + b.length, 0)); let o = 0; for (const b of blocks) { body.set(b, o); o += b.length; }
  const mdat = atom("mdat", body); const out = new Uint8Array(ftyp.length + udta.length + mdat.length);
  out.set(ftyp, 0); out.set(udta, ftyp.length); out.set(mdat, ftyp.length + udta.length); return out;
}
const te = (s: string) => new TextEncoder().encode(s);

// Watermark a REAL seller-uploaded file. Text formats get embedded marks/canaries;
// binary formats pass through and rely on the fingerprint registry (sha256 + license trail).
export function watermarkRealFile(bytes: Uint8Array, ext: string, id: string, code: string): WmResult {
  const mimeMap: Record<string, string> = { md: "text/markdown", txt: "text/plain", csv: "text/csv", jsonl: "application/jsonl", svg: "image/svg+xml", zip: "application/zip", safetensors: "application/octet-stream", gguf: "application/octet-stream", wav: "audio/wav", mp3: "audio/mpeg", mp4: "video/mp4" };
  const mime = mimeMap[ext] ?? "application/octet-stream";
  if (ext === "md" || ext === "txt") return { bytes: te(wmText(dec.decode(bytes), code)), filename: `${id}.${ext}`, mime, method: "zero-width-text", format: ext };
  if (ext === "csv" || ext === "jsonl") {
    const sig = "CN" + code.split(".")[1] + code.slice(-8);
    const lines = dec.decode(bytes).split("\n"); const positions: number[] = [];
    for (let i = 0; i < 3; i++) {
      const pos = Math.min(lines.length, Math.floor((i + 1) * lines.length / 4) + i);
      const canary = ext === "jsonl" ? JSON.stringify({ id: `rec_${sig}_${i}`, _ref: sig }) : `rec_${sig}_${i},,${sig}`;
      lines.splice(pos, 0, canary); positions.push(pos);
    }
    return { bytes: te(lines.join("\n")), filename: `${id}.${ext}`, mime, method: "canary-rows", format: ext, canary: { signature: sig, positions } };
  }
  if (ext === "svg") {
    const mark = "\u2060" + [...toBits(code)].map((b) => (b === "0" ? "\u200B" : "\u200C")).join("") + "\u2060";
    const s = dec.decode(bytes);
    const out = s.includes("</svg>") ? s.replace("</svg>", `<desc>${mark}</desc></svg>`) : s + `<!--${mark}-->`;
    return { bytes: te(out), filename: `${id}.svg`, mime, method: "svg-zero-width", format: "svg" };
  }
  return { bytes, filename: `${id}.${ext}`, mime, method: "registry-fingerprint", format: ext };
}

export function buildArtifact(product: any, code: string, docText: string): WmResult {
  const t = product.type; const id = product.id;
  if (["dataset", "rag"].includes(t)) {
    const isJsonl = (product.meta && JSON.stringify(product.meta).includes("JSONL")) || t === "rag"; const d = wmDataset(code, isJsonl);
    return { bytes: te(d.content), filename: `${id}.${isJsonl ? "jsonl" : "csv"}`, mime: "text/plain", method: "canary-rows", format: isJsonl ? "jsonl" : "csv", canary: { signature: d.signature, positions: d.positions } };
  }
  if (t === "avatar") return { bytes: wmVideo(code), filename: `${id}-sample.mp4`, mime: "video/mp4", method: "mp4-frame-watermark", format: "mp4" };
  if (t === "voice") return { bytes: wmAudio(code), filename: `${id}-sample.wav`, mime: "audio/wav", method: "lsb-audio", format: "wav" };
  if (t === "model") return { bytes: wmModel(code), filename: `${id}.safetensors`, mime: "application/octet-stream", method: "safetensors-metadata", format: "safetensors" };
  if (t === "assets") return { bytes: te(wmSvg(code)), filename: `${id}.svg`, mime: "image/svg+xml", method: "svg-zero-width", format: "svg" };
  return { bytes: te(wmText(docText, code)), filename: `${id}-SKILL.md`, mime: "text/markdown", method: "zero-width-text", format: "markdown" };
}
