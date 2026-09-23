# Kokoro Local TTS

This build adds Kokoro-82M through `kokoro-js` as the default TTS engine.

- Model: `onnx-community/Kokoro-82M-v1.0-ONNX`
- Runtime: browser/WebView ONNX Runtime through `kokoro-js`
- Default quantization: q8, WASM for compatibility
- First use: downloads and caches the model; later launches reuse the cache
- API key/payment: none for Kokoro inference
- ElevenLabs remains optional and is no longer auto-selected just because a key exists.

The actual model is not bundled into this source zip because the q8 weights are roughly 92 MB; the application downloads them on first use instead of inflating the project archive.

Setup note: this working archive was prepared without a local npm dependency cache/network, so run `npm install` once after extracting. This installs `kokoro-js` and refreshes the lockfile with its transitive dependencies before `npm run build` / `npm run tauri dev`.
