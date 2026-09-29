# Vendored: HeadTTS (British English build for Jobhuntz)

- `modules/` — HeadTTS v1.3.0 by Mika Suominen (https://github.com/met4citizen/HeadTTS,
  commit c08f4ca), MIT licence (see `LICENSE`). Browser modules only. Two changes:
  `modules/language-en-gb.mjs` (new: British English, numbers read with "and") and a
  configurable connect timeout (`connectTimeoutMs`) in `modules/headtts.mjs`.
- `dictionaries/en-gb.txt` — generated from misaki's `gb_gold.json` and `gb_silver.json`
  (https://github.com/hexgrad/misaki, commit fba1236), Copyright hexgrad, Apache License 2.0.
- `voices/bf_emma.bin`, `voices/bm_george.bin` — Kokoro-82M v1.0 voice embeddings
  (https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), Apache License 2.0.
- The Kokoro model itself is downloaded by the browser from Hugging Face
  (`onnx-community/Kokoro-82M-v1.0-ONNX-timestamped`, Apache License 2.0).
