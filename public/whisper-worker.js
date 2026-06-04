// Whisper speech-to-text worker for follow mode (prototype).
//
// Runs on-device automatic speech recognition via transformers.js. It loads a
// small English Whisper model once, then transcribes short rolling windows of
// microphone audio (16 kHz mono Float32) posted from the main thread. The text
// it returns is matched against the song's lyrics by follow-mode.js; this worker
// has no knowledge of songs or scrolling.

import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

// Only pull weights from the Hugging Face hub, never look for a local copy.
env.allowLocalModels = false;

let transcriber = null;
let activeDevice = "";

async function load(model) {
  postMessage({ type: "status", text: `Loading ${model}...` });

  // Prefer WebGPU; fall back to WASM so the prototype still runs without it.
  try {
    transcriber = await pipeline("automatic-speech-recognition", model, {
      device: "webgpu",
      dtype: "fp32"
    });
    activeDevice = "webgpu";
  } catch (webgpuError) {
    postMessage({ type: "status", text: "WebGPU unavailable, using WASM (slower)..." });
    transcriber = await pipeline("automatic-speech-recognition", model);
    activeDevice = "wasm";
  }

  postMessage({ type: "ready", device: activeDevice, model });
}

onmessage = async (event) => {
  const message = event.data;

  if (message.type === "load") {
    try {
      await load(message.model);
    } catch (error) {
      postMessage({ type: "error", text: `Model load failed: ${String(error)}` });
    }
    return;
  }

  if (message.type === "audio") {
    if (!transcriber) return;
    try {
      const output = await transcriber(message.audio);
      postMessage({
        type: "transcript",
        id: message.id,
        text: (output.text || "").trim()
      });
    } catch (error) {
      postMessage({ type: "error", id: message.id, text: `Transcribe failed: ${String(error)}` });
    }
  }
};
