# skillz.ai — Product Type Reference
**What each type is · typical file formats · average vs large file sizes**
Researched 2026-07-04. Sizes are for the *deliverable the buyer downloads*, not the seller's working files.

---

## Quick reference table

| Type | What it is | Typical formats | Average size | Large size | Our cap today |
|---|---|---|---|---|---|
| Skill | Instruction/capability bundle for an LLM | .md, .zip (md + scripts/assets) | 5–100 KB | 1–10 MB | 10 MB ✅ |
| Prompt pack | Curated, tested prompt collection | .md, .zip, (json/yaml inside) | 10–200 KB | 1–5 MB | 10 MB ✅ |
| Workflow | Multi-step chain of skills/tools | .md, .zip (config + docs) | 20–500 KB | 2–10 MB | 10 MB ✅ |
| Dataset | Training/eval data | .csv, .jsonl, .parquet, .zip | 5–500 MB | 1 GB – 1 TB+ | 10 MB ⚠️ small only |
| RAG pack | Retrieval corpus ± embeddings | .jsonl, .csv, .zip (docs + vectors) | 50 MB – 1 GB | 5–50 GB | 10 MB ⚠️ |
| Model / LoRA | Fine-tune adapter or full weights | .safetensors, .gguf | LoRA: 30–100 MB | full GGUF: 4–10 GB+ | 10 MB ⚠️ |
| Avatar | Video/animated presenter | .mp4, .zip (rig/renders) | 100–500 MB | 2–20 GB | 10 MB ⚠️ |
| Voice | TTS voice model or voice pack | .pth/.zip (model), .wav/.mp3 (samples) | 50–300 MB | 1–4 GB | 10 MB ⚠️ |
| Eval suite | Benchmark/test harness | .md, .jsonl, .zip | 1–50 MB | 100–500 MB | 10 MB ⚠️ borderline |
| Asset pack | Design assets (icons, illustrations, textures) | .zip, .svg | 20–200 MB | 1–10 GB | 10 MB ⚠️ |

✅ = fits the current 10 MB MVP upload cap · ⚠️ = real products routinely exceed it (see "Implications" at the end).

---

## 1. Skills
**Definition:** A packaged capability for an LLM — structured instructions, reference material, and optionally helper scripts that teach a model to do one job well (e.g., "Deep Data Analyst"). The dominant real-world format is a folder with a `SKILL.md` plus optional assets, zipped for distribution.
**Formats:** `.md` (single-file skills), `.zip` (SKILL.md + scripts/templates/examples).
**Sizes:** Text instructions are tiny — most skills are **5–100 KB**. Skills that bundle scripts, few-shot example files, or reference documents reach **1–10 MB**. Anything bigger usually means someone embedded data that belongs in a dataset product.

## 2. Prompt packs
**Definition:** A curated library of tested prompts/templates for specific outcomes (cold email vault, Socratic tutor pack), usually organized with usage notes and variables to fill.
**Formats:** `.md` is standard; `.zip` when packs ship as many files or include JSON/YAML for programmatic use.
**Sizes:** Pure text — **10–200 KB average**. Hundred-prompt mega-packs with documentation still sit **under 5 MB**. This is the lightest product type on the marketplace.

## 3. Workflows
**Definition:** A chain of skills/tools with routing logic — "outbound engine" style multi-step automations. The deliverable is the orchestration definition plus per-step docs.
**Formats:** `.md`, `.zip` (workflow config — often JSON/YAML — plus docs per step).
**Sizes:** Configuration + docs = **20–500 KB typical**, up to a few MB with rich examples. Like skills, essentially text.

## 4. Datasets
**Definition:** Structured data for fine-tuning, evaluation, or analysis (labeled examples, dialogues, domain corpora). Sold by size tier on skillz.ai (small ⬡15 / medium ⬡30 / large & XL seller-priced).
**Formats:** `.jsonl` is the fine-tuning standard (one JSON record per line); `.csv` for tabular; `.parquet` for columnar/large; `.zip` for multi-file corpora.
**Sizes:** Highly variable — the widest range of any type. A quality instruction-tuning set of 1k–50k examples runs **5–500 MB** (reference point: the classic 52k-example Alpaca set is ~24 MB; platforms like Google Vertex cap single JSONL files at 1 GB; practitioners split files at 1–10 GB for loading). "Large": multi-million-record or multimodal corpora hit **tens of GB to TB**. Sensible tier guide for us: **small < 100 MB · medium 100 MB–1 GB · large 1–10 GB · XL > 10 GB**.

## 5. RAG packs
**Definition:** A retrieval-ready knowledge corpus — cleaned source documents, chunked text, and often precomputed embeddings — that grounds an LLM in a domain (e.g., US Tax Code pack).
**Formats:** `.jsonl`/`.csv` for chunks + metadata, `.zip` bundling source docs and vector files.
**Sizes:** Two components: the text corpus (MBs–GBs) and embeddings, which are heavy — a 1536-dimension float32 vector is ~6 KB, so **100k chunks ≈ 600 MB of vectors alone**. Average packs: **50 MB–1 GB**. Large regulatory/legal corpora with embeddings: **5–50 GB**.

## 6. Models / LoRAs
**Definition:** Fine-tuned model weights. On a marketplace this is usually a **LoRA/QLoRA adapter** (a small delta applied to a base model like Llama) rather than full weights; full models ship as quantized GGUF for local inference.
**Formats:** `.safetensors` (adapters + full weights; the safe standard), `.gguf` (quantized, llama.cpp ecosystem).
**Sizes:**
- **LoRA adapters (the typical marketplace product): 30–100 MB** at common rank 16 (measured examples: 45 MB for a Llama 3.2 adapter, 34 MB for an 8B, 101 MB for a 24B). Higher ranks grow linearly: r=256 ≈ 770 MB, r=512 ≈ 1.5 GB.
- **Full quantized models: 4–5 GB** for a 7B at Q4_K_M, **~8–10 GB** at Q8, **~14 GB** at FP16 — and 70B-class models reach 40 GB+.
Rule of thumb: adapters are "big-download" (100 MB-class), full models are "multi-GB" products.

## 7. Avatars
**Definition:** A digital presenter — rendered video avatar, 2D animation rig, or talking-head persona — licensed for personal use (⬡60) or commercially (seller-$, perpetual).
**Formats:** `.mp4` (rendered video/preview reels), `.zip` (rig files, expression sets, multiple renders — e.g., Lottie/GIF exports).
**Sizes:** Driven by video math. 4K H.264 runs **~340 MB/minute** at YouTube-grade 45 Mbps (90–110 MB/min at lower bitrates; H.265 halves this). So: a 1-minute demo reel = **100–350 MB average**; a full avatar package with multiple 4K renders or a rig + assets = **2–20 GB**. 1080p halves-to-quarters these numbers.

## 8. Voices
**Definition:** A TTS voice — either a trained voice-model checkpoint (RVC/XTTS-style) buyers run locally, or a licensed voice pack of rendered audio. Same licensing split as avatars.
**Formats:** `.wav`/`.mp3` (samples and rendered packs), model checkpoints ship as `.pth` inside `.zip`.
**Sizes:** RVC-class voice checkpoints run **~50–60 MB** plus a retrieval index (tens of MB); full multi-speaker TTS models like XTTS need **~2–4 GB** on disk. Rendered audio: studio WAV is ~10 MB/minute (44.1 kHz/16-bit stereo), MP3 ~1 MB/minute. Average product: **50–300 MB**; large (full model + hours of samples): **1–4 GB**.

## 9. Eval suites
**Definition:** Benchmark/test harnesses that score model behavior — safety suites, capability benchmarks, regression tests — with test cases, scoring logic, and docs.
**Formats:** `.jsonl` (test cases), `.md` (methodology), `.zip` (harness + cases).
**Sizes:** Focused suites (hundreds of cases) are **1–10 MB**; serious benchmarks are bigger than people expect — MMLU-class multi-domain suites run **100–200 MB**; adversarial suites with media inputs can reach **500 MB**. Average: **1–50 MB**.

## 10. Asset packs
**Definition:** Design assets for AI-adjacent products — icon sets, illustrations, textures, UI kits (e.g., Neo-Brutalist UI pack).
**Formats:** `.zip` (the norm — mixed SVG/PNG/source files), `.svg` for single-format vector sets.
**Sizes:** Pure-vector icon sets are light (**5–50 MB**); packs adding PNG exports at multiple resolutions or textures run **20–200 MB average**; illustration/texture mega-bundles with source files (AI/PSD/4K PNG) hit **1–10 GB**.

---

## Implications for skillz.ai

1. **The 10 MB MVP cap fully covers 3 of 10 types** (skills, prompts, workflows) and small datasets/evals. It excludes the realistic center of the market for models (30–100 MB LoRAs), voices, avatars, RAG packs, datasets medium+, and most asset packs.
2. **✅ IMPLEMENTED (2026-07-04):** per-type caps are now enforced server-side (submit-product v4) and shown in the upload UI: skills/prompts/workflows 25 MB · evals 500 MB · datasets by tier (100 MB / 1 GB / 10 GB / 50 GB) · RAG & asset packs 10 GB · voices 5 GB · models & avatars 20 GB. Files ≤10 MB go inline; larger files use a two-phase flow (`init_upload` → signed direct-to-storage upload). Large binaries are delivered to buyers via short-lived signed URLs (acquire v6). **Note:** the project's global storage upload limit (Dashboard → Storage) still caps actual uploads — 50 MB on the free plan; raise it (paid plan) to unlock the GB-class limits. The bundles bucket is already set to 50 GB.
3. **Watermark strategy already matches formats:** text types get zero-width marks, datasets/RAG get canary rows, and the binary formats (safetensors/gguf/wav/mp4/zip) rely on the fingerprint registry — consistent with what sellers will actually upload.
4. **Dataset tier boundaries** (for the seller guide): small < 100 MB · medium 100 MB–1 GB · large 1–10 GB · XL > 10 GB.

## Sources
- [Runpod — LLM fine-tuning FAQs (LoRA adapter sizes)](https://www.runpod.io/articles/guides/llm-fine-tuning-on-a-budget-top-faqs-on-adapters-lora-and-other-parameter-efficient-methods)
- [Hugging Face — llama-3.2 LoRA adapter (45 MB example)](https://huggingface.co/danielhanchen/llama-3.2-lora/blob/main/adapter_model.safetensors)
- [Modular docs — LoRA adapters in serving](https://docs.modular.com/max/serve/lora-adapters/)
- [Will It Run AI — GGUF quantization guide 2026](https://willitrunai.com/blog/quantization-guide-gguf-explained)
- [LLM Hardware — quantization & VRAM tradeoffs](https://llmhardware.io/guides/llm-quantization-guide)
- [DataCamp — GGUF format guide](https://www.datacamp.com/tutorial/gguf-format-a-complete-guide)
- [CallSphere — JSONL fine-tuning data guide](https://callsphere.ai/blog/best-data-format-for-finetuning-llm-jsonl-guide)
- [Google Cloud Vertex AI — tuning dataset limits](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/translation-supervised-tuning-prepare)
- [Latitude — dataset size impact on fine-tuning](https://latitude.so/blog/dataset-size-impacts-llm-fine-tuning)
- [Compresto — video file size by bitrate (4K MB/min)](https://compresto.app/blog/video-file-size-calculator)
- [WinXDVD — 4K video size 30/60fps](https://www.winxdvd.com/resource/4k-video-file-size-compress.htm)
- [Coqui XTTS-v2 (voice model footprint)](https://huggingface.co/coqui/XTTS-v2)
- [AllTalk TTS wiki — RVC voice models](https://github.com/erew123/alltalk_tts/wiki/RVC-(Retrieval%E2%80%90based-Voice-Conversion))
