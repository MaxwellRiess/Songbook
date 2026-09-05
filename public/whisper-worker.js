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
let activeLoadId = 0;

async function load(model, device, dtype, loadId) {
  postMessage({ type: "status", loadId, text: `Loading ${model} (${device}/${dtype})...` });

  let nextTranscriber;
  let nextDevice;

  // Try the requested device/precision, then fall back to the lightest stable
  // option (WASM + q8). On mobile the caller asks for WASM/q8 directly, which
  // uses far less memory than WebGPU/fp32 and avoids iOS GPU-process crashes.
  try {
    nextTranscriber = await pipeline("automatic-speech-recognition", model, { device, dtype });
    nextDevice = device;
  } catch (primaryError) {
    if (device === "wasm" && dtype === "q8") throw primaryError;
    postMessage({
      type: "status",
      loadId,
      text: "Falling back to WASM/q8 (lighter)..."
    });
    nextTranscriber = await pipeline("automatic-speech-recognition", model, {
      device: "wasm",
      dtype: "q8"
    });
    nextDevice = "wasm";
  }

  // A model switch may have started while this download was in flight. Never
  // let the older completion silently replace the newer requested model.
  if (loadId !== activeLoadId) {
    if (typeof nextTranscriber?.dispose === "function") await nextTranscriber.dispose();
    return;
  }

  const previousTranscriber = transcriber;
  transcriber = nextTranscriber;
  activeDevice = nextDevice;
  if (previousTranscriber && typeof previousTranscriber.dispose === "function") {
    await previousTranscriber.dispose();
  }
  postMessage({ type: "ready", loadId, device: activeDevice, model });
}

onmessage = async (event) => {
  const message = event.data;

  if (message.type === "load") {
    activeLoadId = message.loadId;
    try {
      await load(message.model, message.device || "wasm", message.dtype || "q8", message.loadId);
    } catch (error) {
      if (message.loadId === activeLoadId) {
        postMessage({
          type: "error",
          loadId: message.loadId,
          text: `Model load failed: ${String(error)}`
        });
      }
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
        generation: message.generation,
        text: (output.text || "").trim()
      });
    } catch (error) {
      postMessage({
        type: "error",
        id: message.id,
        generation: message.generation,
        text: `Transcribe failed: ${String(error)}`
      });
    }
  }
};
