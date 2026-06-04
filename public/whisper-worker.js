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

async function load(model, device, dtype) {
  postMessage({ type: "status", text: `Loading ${model} (${device}/${dtype})...` });

  // Try the requested device/precision, then fall back to the lightest stable
  // option (WASM + q8). On mobile the caller asks for WASM/q8 directly, which
  // uses far less memory than WebGPU/fp32 and avoids iOS GPU-process crashes.
  try {
    transcriber = await pipeline("automatic-speech-recognition", model, { device, dtype });
    activeDevice = device;
  } catch (primaryError) {
    if (device === "wasm" && dtype === "q8") throw primaryError;
    postMessage({ type: "status", text: "Falling back to WASM/q8 (lighter)..." });
    transcriber = await pipeline("automatic-speech-recognition", model, {
      device: "wasm",
      dtype: "q8"
    });
    activeDevice = "wasm";
  }

  postMessage({ type: "ready", device: activeDevice, model });
}

onmessage = async (event) => {
  const message = event.data;

  if (message.type === "load") {
    try {
      await load(message.model, message.device || "wasm", message.dtype || "q8");
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
