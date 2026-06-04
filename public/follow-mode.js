// Follow mode (prototype) — automatic position detection and scrolling.
//
// The concept: we already know every lyric in the song, so we never need to
// transcribe singing accurately. We only need to pick which line the singer is
// on from a short window of upcoming lines. Whisper (whisper-worker.js) gives a
// rough transcript of the last few seconds of audio; the matcher below scores
// that against nearby lyric lines, biases forward, and only moves when it is
// confident enough. A debug panel exposes everything so the concept can be
// judged by watching it track.
//
// This module is self-contained: it builds its own button, panel and styles,
// and watches the viewer for song changes. It does not modify the renderer or
// the existing autoscroll.

const MODEL = "Xenova/whisper-tiny.en"; // small + fast; swap to whisper-base.en for accuracy
const SAMPLE_RATE = 16000;
const WINDOW_SECONDS = 4; // audio sent to Whisper each step (shorter = fresher, less lag)
const STEP_MS = 1000; // how often we transcribe
const RING_SECONDS = 7; // rolling audio buffer length
const RMS_FLOOR = 0.012; // skip near-silent windows (avoids Whisper hallucinating)
const READING_ANCHOR = 0.3; // where the "current" line sits in the viewer (0=top)
const HEARD_TAIL = 7; // only match the most recent N heard words, so the lock tracks "now" not 4s ago

// Matcher thresholds.
const LOOKBACK = 1; // how far back a match may land
const LOOKAHEAD = 6; // how far ahead a match may land
const MIN_OVERLAP = 2; // need at least this many matched words to move
const MARGIN = 1; // best must beat runner-up by this much

export function initFollowMode({ viewer, getSelectedSong, onBeforeStart }) {
  injectStyles();
  const ui = buildUi();

  const followState = {
    active: false,
    loading: false,
    ready: false,
    anchors: [], // { element, index, tokens, text }
    currentIndex: -1,
    worker: null,
    workerBusy: false,
    audioContext: null,
    stream: null,
    workletNode: null,
    ring: new Float32Array(SAMPLE_RATE * RING_SECONDS),
    captureRate: SAMPLE_RATE, // actual hardware rate; may differ from 16 kHz on mobile
    ringWritten: 0,
    stepTimer: null,
    requestId: 0,
    wakeLock: null
  };

  ui.toggle.addEventListener("click", () => {
    if (followState.active) {
      stop();
    } else {
      start();
    }
  });

  // Re-extract lyric anchors whenever the sheet changes (new song, transpose,
  // font size re-render). Cheap, and keeps follow mode in sync with no renderer
  // changes.
  const observer = new MutationObserver(() => {
    rebuildAnchors();
  });
  observer.observe(viewer, { childList: true });
  rebuildAnchors();

  function rebuildAnchors() {
    followState.anchors = extractAnchors(viewer);
    followState.currentIndex = -1;
    clearHighlight();
    updateToggleEnabled();
    renderDebugAnchors();
  }

  function updateToggleEnabled() {
    const hasLyrics = followState.anchors.length > 0;
    ui.toggle.disabled = !hasLyrics && !followState.active;
  }

  async function start() {
    if (followState.active) return;
    if (!followState.anchors.length) {
      setStatus("No lyric lines detected in this song.");
      return;
    }
    if (typeof onBeforeStart === "function") onBeforeStart();

    followState.active = true;
    ui.panel.classList.remove("hidden");
    ui.toggle.textContent = "Stop following";
    ui.toggle.classList.add("is-active");

    try {
      await startAudio();
      startWorker();
      await requestWakeLock();
      followState.stepTimer = window.setInterval(stepTranscribe, STEP_MS);
      setStatus("Listening...");
    } catch (error) {
      setStatus(`Could not start: ${error.message || error}`);
      stop();
    }
  }

  function stop() {
    followState.active = false;
    ui.toggle.textContent = "Follow (beta)";
    ui.toggle.classList.remove("is-active");

    if (followState.stepTimer) {
      window.clearInterval(followState.stepTimer);
      followState.stepTimer = null;
    }
    stopAudio();
    releaseWakeLock();
    // Leave the worker loaded so a restart is instant; just mark it idle.
    followState.workerBusy = false;
    updateToggleEnabled();
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      followState.wakeLock = await navigator.wakeLock.request("screen");
    } catch (error) {
      // Non-fatal: some browsers refuse without an active gesture or on low battery.
    }
  }

  function releaseWakeLock() {
    if (!followState.wakeLock) return;
    followState.wakeLock.release().catch(() => {});
    followState.wakeLock = null;
  }

  // The OS drops the wake lock and may suspend audio when the app is backgrounded.
  // Re-acquire and resume when the singer returns to the page.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !followState.active) return;
    if (!followState.wakeLock) requestWakeLock();
    if (followState.audioContext && followState.audioContext.state === "suspended") {
      followState.audioContext.resume().catch(() => {});
    }
  });

  // ---- Audio capture -----------------------------------------------------

  async function startAudio() {
    followState.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    // Desktop Chrome honours a forced 16 kHz context. Mobile Safari and some
    // Android devices ignore it and run at the hardware rate, so we read the
    // real rate and resample when reading windows rather than assuming 16 kHz.
    try {
      followState.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    } catch (error) {
      followState.audioContext = new AudioContext();
    }
    const context = followState.audioContext;
    if (context.state === "suspended") await context.resume();

    followState.captureRate = context.sampleRate;
    followState.ring = new Float32Array(Math.ceil(followState.captureRate * RING_SECONDS));
    followState.ringWritten = 0;

    const workletUrl = URL.createObjectURL(
      new Blob([CAPTURE_WORKLET], { type: "application/javascript" })
    );
    await context.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    const source = context.createMediaStreamSource(followState.stream);
    followState.workletNode = new AudioWorkletNode(context, "follow-capture");
    followState.workletNode.port.onmessage = (event) => writeRing(event.data);

    // Connect through a silent gain to keep the graph pulling without audible
    // monitoring or feedback.
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(followState.workletNode);
    followState.workletNode.connect(silent);
    silent.connect(context.destination);
  }

  function stopAudio() {
    if (followState.workletNode) {
      followState.workletNode.port.onmessage = null;
      followState.workletNode.disconnect();
      followState.workletNode = null;
    }
    if (followState.audioContext) {
      followState.audioContext.close();
      followState.audioContext = null;
    }
    if (followState.stream) {
      followState.stream.getTracks().forEach((track) => track.stop());
      followState.stream = null;
    }
  }

  function writeRing(chunk) {
    const ring = followState.ring;
    let write = followState.ringWritten % ring.length;
    for (let i = 0; i < chunk.length; i += 1) {
      ring[write] = chunk[i];
      write = (write + 1) % ring.length;
    }
    followState.ringWritten += chunk.length;
  }

  function readWindow(seconds) {
    const ring = followState.ring;
    const captureRate = followState.captureRate || SAMPLE_RATE;
    const count = Math.min(Math.floor(captureRate * seconds), followState.ringWritten, ring.length);
    const raw = new Float32Array(count);
    let read = (followState.ringWritten - count) % ring.length;
    if (read < 0) read += ring.length;
    for (let i = 0; i < count; i += 1) {
      raw[i] = ring[read];
      read = (read + 1) % ring.length;
    }
    return resampleTo16k(raw, captureRate);
  }

  // ---- Whisper worker ----------------------------------------------------

  function startWorker() {
    if (followState.worker) return;
    followState.loading = true;
    setStatus("Loading speech model (first run downloads it)...");

    followState.worker = new Worker(new URL("./whisper-worker.js", import.meta.url), {
      type: "module"
    });

    followState.worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "status") {
        setStatus(message.text);
      } else if (message.type === "ready") {
        followState.ready = true;
        followState.loading = false;
        setStatus(`Model ready on ${message.device}. Listening...`);
      } else if (message.type === "transcript") {
        followState.workerBusy = false;
        handleTranscript(message.text);
      } else if (message.type === "error") {
        followState.workerBusy = false;
        setStatus(message.text);
      }
    };

    followState.worker.postMessage({ type: "load", model: MODEL });
  }

  function stepTranscribe() {
    if (!followState.active || !followState.ready || followState.workerBusy) return;

    const audio = readWindow(WINDOW_SECONDS);
    if (audio.length < SAMPLE_RATE) return; // wait for at least a second of audio

    if (rms(audio) < RMS_FLOOR) {
      setHeard("(quiet)");
      return;
    }

    followState.workerBusy = true;
    const id = (followState.requestId += 1);
    followState.worker.postMessage({ type: "audio", id, audio }, [audio.buffer]);
  }

  // ---- Matcher -----------------------------------------------------------

  function handleTranscript(text) {
    setHeard(text || "(nothing)");
    const heard = tokenize(text);
    if (!heard.length) return;

    // Match only the most recent words. Whisper's window holds a line or two of
    // history; using the tail makes the lock reflect where the singer is now
    // rather than where they were when the window opened.
    const recent = heard.slice(-HEARD_TAIL);
    const result = matchPosition(followState.anchors, followState.currentIndex, recent);
    renderCandidates(result.candidates);

    if (result.committedIndex !== -1 && result.committedIndex !== followState.currentIndex) {
      followState.currentIndex = result.committedIndex;
      highlightAndScroll(result.committedIndex);
    }
  }

  function highlightAndScroll(index) {
    const anchor = followState.anchors[index];
    if (!anchor) return;
    clearHighlight();
    anchor.element.classList.add("follow-current-line");

    const viewerRect = viewer.getBoundingClientRect();
    const elementRect = anchor.element.getBoundingClientRect();
    const target =
      viewer.scrollTop +
      (elementRect.top - viewerRect.top) -
      viewer.clientHeight * READING_ANCHOR;
    viewer.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }

  function clearHighlight() {
    viewer
      .querySelectorAll(".follow-current-line")
      .forEach((node) => node.classList.remove("follow-current-line"));
  }

  // Clicking a lyric line manually sets position. Doubles as reset and as a way
  // to mark ground truth while evaluating.
  viewer.addEventListener("click", (event) => {
    if (!followState.active) return;
    const line = event.target.closest(".sheet-line");
    if (!line) return;
    const found = followState.anchors.find((anchor) => anchor.element === line);
    if (!found) return;
    followState.currentIndex = found.index;
    highlightAndScroll(found.index);
    setStatus(`Manually set to line ${found.index + 1}.`);
  });

  // ---- Debug panel -------------------------------------------------------

  function setStatus(text) {
    ui.status.textContent = text;
  }

  function setHeard(text) {
    ui.heard.textContent = text;
  }

  function renderCandidates(candidates) {
    ui.candidates.replaceChildren();
    candidates.slice(0, 3).forEach((candidate) => {
      const row = document.createElement("div");
      row.className = "follow-candidate";
      row.textContent = `#${candidate.index + 1}  score ${candidate.score.toFixed(
        1
      )}  ${candidate.text.slice(0, 40)}`;
      ui.candidates.append(row);
    });
  }

  function renderDebugAnchors() {
    ui.anchorCount.textContent = `${followState.anchors.length} lyric lines`;
  }
}

// ---- Pure helpers (recogniser-independent, easy to reason about) ----------

export function extractAnchors(viewer) {
  const anchors = [];
  viewer.querySelectorAll(".sheet-line").forEach((element) => {
    if (element.classList.contains("plain-chord-line")) return; // chord-only row
    const lyricNode = element.querySelector(".pair-desktop-lyrics");
    const text = (lyricNode ? lyricNode.textContent : element.textContent) || "";
    const tokens = tokenize(text);
    if (!tokens.length) return; // blank or punctuation-only line
    anchors.push({ element, index: anchors.length, tokens, text: text.trim() });
  });
  return anchors;
}

export function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

// Score nearby lines against the heard words, bias forward, and commit only when
// the best line clears the overlap floor and beats the runner-up by a margin.
export function matchPosition(anchors, currentIndex, heard) {
  const heardSet = new Set(heard);
  const start = Math.max(0, currentIndex < 0 ? 0 : currentIndex - LOOKBACK);
  const end = Math.min(
    anchors.length - 1,
    currentIndex < 0 ? anchors.length - 1 : currentIndex + LOOKAHEAD
  );

  const candidates = [];
  for (let index = start; index <= end; index += 1) {
    const anchor = anchors[index];
    let overlap = 0;
    for (const token of new Set(anchor.tokens)) {
      if (heardSet.has(token)) overlap += 1;
    }
    // Forward prior: reward staying or stepping forward one, penalise jumps and
    // any backward move.
    let prior = 0;
    if (currentIndex >= 0) {
      const step = index - currentIndex;
      if (step < 0) prior = -2;
      else if (step === 0 || step === 1) prior = 0.5;
      else prior = -0.4 * (step - 1);
    }
    candidates.push({ index, score: overlap + prior, overlap, text: anchor.text });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const second = candidates[1];

  let committedIndex = -1;
  if (best && best.overlap >= MIN_OVERLAP) {
    const beatsRunnerUp = !second || best.score - second.score >= MARGIN;
    if (beatsRunnerUp) committedIndex = best.index;
  }

  return { committedIndex, candidates };
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// Linear-interpolation resample to 16 kHz, which is what Whisper expects. Mobile
// devices often capture at 44.1/48 kHz, so without this the transcript comes out
// at the wrong speed and matches nothing.
export function resampleTo16k(input, inputRate) {
  if (!input.length || inputRate === SAMPLE_RATE) return input;
  const ratio = SAMPLE_RATE / inputRate;
  const outLength = Math.round(input.length * ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const position = i / ratio;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, input.length - 1);
    const fraction = position - lower;
    output[i] = input[lower] * (1 - fraction) + input[upper] * fraction;
  }
  return output;
}

// ---- Inline UI + worklet ---------------------------------------------------

function buildUi() {
  const toggle = document.createElement("button");
  toggle.id = "followToggle";
  toggle.type = "button";
  toggle.className = "follow-toggle";
  toggle.textContent = "Follow (beta)";
  toggle.disabled = true;

  const controls = document.querySelector("#autoscrollControls");
  if (controls) controls.append(toggle);
  else document.body.append(toggle);

  const panel = document.createElement("div");
  panel.className = "follow-debug hidden";
  panel.innerHTML = `
    <button type="button" class="follow-debug-head" data-collapse aria-expanded="true">
      <span>Follow mode (debug)</span><span class="follow-collapse-icon">&#9660;</span>
    </button>
    <div class="follow-debug-body">
      <div class="follow-row"><span>Status</span><div data-status>idle</div></div>
      <div class="follow-row"><span>Anchors</span><div data-anchor-count>0 lyric lines</div></div>
      <div class="follow-row"><span>Heard</span><div data-heard>-</div></div>
      <div class="follow-row"><span>Candidates</span><div data-candidates></div></div>
    </div>
  `;
  document.body.append(panel);

  const collapseButton = panel.querySelector("[data-collapse]");
  collapseButton.addEventListener("click", () => {
    const collapsed = panel.classList.toggle("collapsed");
    collapseButton.setAttribute("aria-expanded", String(!collapsed));
  });

  return {
    toggle,
    panel,
    status: panel.querySelector("[data-status]"),
    anchorCount: panel.querySelector("[data-anchor-count]"),
    heard: panel.querySelector("[data-heard]"),
    candidates: panel.querySelector("[data-candidates]")
  };
}

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .follow-toggle { margin-left: 8px; }
    .follow-toggle.is-active { outline: 2px solid currentColor; }
    .follow-current-line { background: rgba(255, 215, 0, 0.22); border-radius: 4px; }
    .follow-debug {
      position: fixed; right: 12px; bottom: 12px; width: 320px; z-index: 9999;
      background: rgba(20, 20, 24, 0.92); color: #f4f4f5; font: 12px/1.4 ui-monospace, monospace;
      padding: 10px 12px; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.4);
    }
    .follow-debug.hidden { display: none; }
    .follow-debug-head {
      display: flex; justify-content: space-between; align-items: center; gap: 8px;
      width: 100%; font: inherit; font-weight: 700; color: inherit; cursor: pointer;
      background: none; border: 0; padding: 0; margin-bottom: 6px; text-align: left;
    }
    .follow-collapse-icon { transition: transform 0.15s; opacity: 0.7; }
    .follow-debug.collapsed .follow-collapse-icon { transform: rotate(-90deg); }
    .follow-debug.collapsed .follow-debug-body { display: none; }
    .follow-debug.collapsed { width: auto; }
    .follow-row { display: grid; grid-template-columns: 70px 1fr; gap: 6px; margin: 4px 0; }
    .follow-row > span { opacity: 0.6; }
    .follow-candidate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;
  document.head.append(style);
}

// AudioWorklet processor: forwards mono Float32 frames to the main thread.
const CAPTURE_WORKLET = `
class FollowCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('follow-capture', FollowCapture);
`;
