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

const MODEL_DESKTOP = "Xenova/whisper-base.en"; // default desktop model
const MODEL_MOBILE = "Xenova/whisper-tiny.en"; // smaller + lighter for memory-limited phones

// Desktop model options, switchable from the debug panel to compare accuracy
// versus speed. Bigger = more accurate but slower and a larger one-time download.
const DESKTOP_MODELS = [
  { id: "Xenova/whisper-tiny.en", label: "tiny.en (fastest)" },
  { id: "Xenova/whisper-base.en", label: "base.en (balanced)" },
  { id: "Xenova/whisper-small.en", label: "small.en (most accurate)" }
];
const SAMPLE_RATE = 16000;
const WINDOW_SECONDS = 4; // audio sent to Whisper each step (shorter = fresher, less lag)
const STEP_MS = 1000; // how often we transcribe
const RING_SECONDS = 7; // rolling audio buffer length
const MIN_RMS_FLOOR = 0.006; // absolute backstop for near-silent microphone input
const NOISE_MULTIPLIER = 2.2; // speech must rise above the learned room-noise floor
const READING_ANCHOR = 0.3; // where the "current" line sits in the viewer (0=top)
const READING_ZONE_START = 0.18; // don't scroll while the line remains in this comfortable zone
const READING_ZONE_END = 0.55;
const SCROLL_COOLDOWN_MS = 650;
const HEARD_TAIL = 7; // only match the most recent N heard words, so the lock tracks "now" not 4s ago
const RECOVERY_AFTER_MISSES = 3; // widen to the whole song after several uncertain windows
const LARGE_JUMP_CONFIRMATIONS = 2; // avoid leaping on a single noisy transcription

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
    loadId: 0,
    generation: 0,
    wakeLock: null,
    songKey: "",
    missCount: 0,
    pendingIndex: -1,
    pendingCount: 0,
    noiseFloor: 0.004,
    lastScrollAt: 0,
    desktopModel: MODEL_DESKTOP, // active desktop model; switchable in the panel
    // Live-tunable knobs, seeded from the defaults. Exposed in the debug panel.
    tuning: {
      windowSeconds: WINDOW_SECONDS,
      stepMs: STEP_MS,
      heardTail: HEARD_TAIL,
      minOverlap: MIN_OVERLAP,
      margin: MARGIN
    }
  };

  wireTuningControls(ui, followState, restartStepTimer);

  ui.modelSelect.addEventListener("change", () => {
    setDesktopModel(ui.modelSelect.value);
  });

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
    const oldAnchors = followState.anchors;
    const oldIndex = followState.currentIndex;
    const oldText = oldAnchors[oldIndex]?.text;
    const nextSongKey = getSongKey(typeof getSelectedSong === "function" ? getSelectedSong() : null);
    const sameSong = nextSongKey === followState.songKey;

    followState.anchors = extractAnchors(viewer);
    followState.songKey = nextSongKey;
    clearHighlight();

    if (sameSong && oldText && followState.anchors.length) {
      followState.currentIndex = findNearestTextMatch(followState.anchors, oldText, oldIndex);
      if (followState.currentIndex !== -1) highlightAndScroll(followState.currentIndex, false);
    } else {
      followState.currentIndex = -1;
      followState.missCount = 0;
      resetPendingMatch();
      // Invalidate a transcript that was recorded for a song which is no longer shown.
      if (oldAnchors.length) followState.generation += 1;
    }
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

    followState.generation += 1;
    followState.missCount = 0;
    followState.noiseFloor = 0.004;
    resetPendingMatch();
    if (followState.currentIndex === -1) {
      followState.currentIndex = indexNearestReadingAnchor(followState.anchors, viewer);
      if (followState.currentIndex !== -1) highlightAndScroll(followState.currentIndex, false);
    }
    followState.active = true;
    ui.panel.classList.remove("hidden");
    ui.toggle.textContent = "Stop following";
    ui.toggle.classList.add("is-active");

    try {
      await startAudio();
      startWorker();
      await requestWakeLock();
      restartStepTimer();
      setStatus("Listening...");
    } catch (error) {
      setStatus(`Could not start: ${error.message || error}`);
      stop();
    }
  }

  // (Re)start the transcription loop at the current step interval. Called on
  // start and whenever the step-rate knob changes.
  function restartStepTimer() {
    if (followState.stepTimer) window.clearInterval(followState.stepTimer);
    if (!followState.active) return;
    followState.stepTimer = window.setInterval(stepTranscribe, followState.tuning.stepMs);
  }

  function stop() {
    followState.active = false;
    followState.generation += 1;
    resetPendingMatch();
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
      const lock = await navigator.wakeLock.request("screen");
      followState.wakeLock = lock;
      lock.addEventListener("release", () => {
        if (followState.wakeLock === lock) followState.wakeLock = null;
      });
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

    // If the worker itself dies (e.g. out of memory), stop cleanly instead of
    // leaving follow mode half-running.
    followState.worker.onerror = () => {
      setStatus("Speech engine stopped (likely low memory). Follow mode off.");
      stop();
    };

    followState.worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "status") {
        if (message.loadId !== followState.loadId) return;
        setStatus(message.text);
      } else if (message.type === "ready") {
        if (message.loadId !== followState.loadId) return;
        followState.ready = true;
        followState.loading = false;
        setStatus(
          followState.active
            ? `Model ready on ${message.device}. Listening...`
            : `Model ready on ${message.device}.`
        );
      } else if (message.type === "transcript") {
        if (message.id === followState.requestId) followState.workerBusy = false;
        if (
          !followState.active ||
          message.id !== followState.requestId ||
          message.generation !== followState.generation
        ) return;
        handleTranscript(message.text);
      } else if (message.type === "error") {
        if (message.id === followState.requestId) followState.workerBusy = false;
        if (message.loadId !== undefined && message.loadId !== followState.loadId) return;
        if (message.generation !== undefined && message.generation !== followState.generation) return;
        setStatus(message.text);
      }
    };

    postLoad();
  }

  // Tell the worker which model/device/precision to load. Mobile gets the light,
  // stable path (WASM + q8) to avoid iOS memory crashes; desktop uses WebGPU and
  // the model the user has selected. Used on first start and on model switches.
  function postLoad() {
    if (!followState.worker) return;
    const mobile = isMobileDevice();
    followState.ready = false;
    followState.workerBusy = false;
    followState.loading = true;
    followState.generation += 1;
    const loadId = (followState.loadId += 1);
    followState.worker.postMessage({
      type: "load",
      loadId,
      model: mobile ? MODEL_MOBILE : followState.desktopModel,
      device: mobile ? "wasm" : "webgpu",
      dtype: mobile ? "q8" : "fp32"
    });
  }

  // Switch the desktop model. If the engine is already running, reload it live so
  // the next transcriptions use the new model.
  function setDesktopModel(modelId) {
    followState.desktopModel = modelId;
    if (followState.worker) {
      setStatus(`Loading ${modelId}...`);
      postLoad();
    }
  }

  function stepTranscribe() {
    if (!followState.active || !followState.ready || followState.workerBusy) return;

    const audio = readWindow(followState.tuning.windowSeconds);
    if (audio.length < SAMPLE_RATE) return; // wait for at least a second of audio

    const level = rms(audio);
    const silenceThreshold = Math.max(MIN_RMS_FLOOR, followState.noiseFloor * NOISE_MULTIPLIER);
    if (level < silenceThreshold) {
      // Learn slowly from quiet windows while retaining an absolute floor.
      followState.noiseFloor = followState.noiseFloor * 0.9 + level * 0.1;
      setHeard("(quiet)");
      return;
    }

    followState.workerBusy = true;
    const id = (followState.requestId += 1);
    followState.worker.postMessage(
      { type: "audio", id, generation: followState.generation, audio },
      [audio.buffer]
    );
  }

  // ---- Matcher -----------------------------------------------------------

  function handleTranscript(text) {
    setHeard(text || "(nothing)");
    const heard = tokenize(text);
    if (!heard.length) return;

    // Match only the most recent words. Whisper's window holds a line or two of
    // history; using the tail makes the lock reflect where the singer is now
    // rather than where they were when the window opened.
    const recent = heard.slice(-followState.tuning.heardTail);
    let result = matchPosition(followState.anchors, followState.currentIndex, recent, {
      minOverlap: followState.tuning.minOverlap,
      margin: followState.tuning.margin
    });

    const currentCandidate = result.candidates.find(
      (candidate) => candidate.index === followState.currentIndex
    );
    const hasUnexplainedContext =
      result.committedIndex === followState.currentIndex &&
      recent.length - (currentCandidate?.overlap || 0) >= 2;

    if (result.committedIndex === -1) {
      followState.missCount += 1;
    } else {
      followState.missCount = 0;
    }

    // A repeated chorus can look like a confident match for the chorus we are
    // already on. Extra transcript words that the current line cannot explain
    // are a useful cue to compare against the full song immediately.
    if (followState.missCount >= RECOVERY_AFTER_MISSES || hasUnexplainedContext) {
      const recovered = matchPosition(followState.anchors, followState.currentIndex, recent, {
        minOverlap: followState.tuning.minOverlap,
        margin: followState.tuning.margin + 0.5,
        global: true
      });
      if (
        recovered.committedIndex !== -1 &&
        recovered.committedIndex !== followState.currentIndex
      ) {
        result = recovered;
      }
    }
    renderCandidates(result.candidates);

    const nextIndex = result.committedIndex;
    if (nextIndex === -1) return;
    if (nextIndex === followState.currentIndex) {
      resetPendingMatch();
      return;
    }

    const isLargeJump =
      followState.currentIndex >= 0 && Math.abs(nextIndex - followState.currentIndex) > 1;
    if (isLargeJump && !confirmPendingMatch(nextIndex)) {
      setStatus(`Possible jump to line ${nextIndex + 1}; listening for confirmation...`);
      return;
    }

    followState.currentIndex = nextIndex;
    followState.missCount = 0;
    resetPendingMatch();
    highlightAndScroll(nextIndex);
    setStatus(`Following line ${nextIndex + 1}.`);
  }

  function resetPendingMatch() {
    followState.pendingIndex = -1;
    followState.pendingCount = 0;
  }

  function confirmPendingMatch(index) {
    if (followState.pendingIndex === index) followState.pendingCount += 1;
    else {
      followState.pendingIndex = index;
      followState.pendingCount = 1;
    }
    return followState.pendingCount >= LARGE_JUMP_CONFIRMATIONS;
  }

  function highlightAndScroll(index, allowScroll = true) {
    const anchor = followState.anchors[index];
    if (!anchor) return;
    clearHighlight();
    anchor.element.classList.add("follow-current-line");

    const viewerRect = viewer.getBoundingClientRect();
    const elementRect = anchor.element.getBoundingClientRect();
    const relativeTop = elementRect.top - viewerRect.top;
    const insideReadingZone =
      relativeTop >= viewer.clientHeight * READING_ZONE_START &&
      relativeTop <= viewer.clientHeight * READING_ZONE_END;
    const now = performance.now();
    if (
      !allowScroll ||
      insideReadingZone ||
      now - followState.lastScrollAt < SCROLL_COOLDOWN_MS
    ) return;

    const target =
      viewer.scrollTop +
      relativeTop -
      viewer.clientHeight * READING_ANCHOR;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewer.scrollTo({ top: Math.max(0, target), behavior: reducedMotion ? "auto" : "smooth" });
    followState.lastScrollAt = now;
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
    followState.missCount = 0;
    resetPendingMatch();
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
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/’/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function getSongKey(song) {
  if (!song) return "";
  if (song.id !== undefined && song.id !== null) return String(song.id);
  return `${song.title || ""}\u0000${song.artist || ""}`;
}

function findNearestTextMatch(anchors, text, previousIndex) {
  const normalized = tokenize(text).join(" ");
  let closest = -1;
  let closestDistance = Infinity;
  for (const anchor of anchors) {
    if (anchor.tokens.join(" ") !== normalized) continue;
    const distance = Math.abs(anchor.index - previousIndex);
    if (distance < closestDistance) {
      closest = anchor.index;
      closestDistance = distance;
    }
  }
  return closest;
}

function indexNearestReadingAnchor(anchors, viewer) {
  if (!anchors.length) return -1;
  const viewerRect = viewer.getBoundingClientRect();
  const target = viewerRect.top + viewer.clientHeight * READING_ANCHOR;
  let closest = anchors[0].index;
  let closestDistance = Infinity;
  for (const anchor of anchors) {
    const distance = Math.abs(anchor.element.getBoundingClientRect().top - target);
    if (distance < closestDistance) {
      closest = anchor.index;
      closestDistance = distance;
    }
  }
  return closest;
}

// Inverse document frequency over the song's lines: a word in few lines is
// distinctive (high weight), a word in many lines ("the", "and") is near
// useless (low weight). This sharpens which line a match points to, and means
// filler words no longer count the same as content words.
export function buildIdf(anchors) {
  const documentFrequency = new Map();
  for (const anchor of anchors) {
    for (const token of new Set(anchor.tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }
  const total = anchors.length || 1;
  return (token) => Math.log(1 + total / ((documentFrequency.get(token) || 0) + 1));
}

// Score nearby lines against the heard words, weighting distinctive words more,
// tolerating Whisper mishearings via fuzzy matches, biasing forward, and
// committing only when the best line clears the overlap floor and beats the
// runner-up by a margin.
export function matchPosition(anchors, currentIndex, heard, options = {}) {
  const minOverlap = options.minOverlap ?? MIN_OVERLAP;
  const margin = options.margin ?? MARGIN;
  const global = options.global ?? false;
  const lookback = options.lookback ?? LOOKBACK;
  const lookahead = options.lookahead ?? LOOKAHEAD;
  const idf = buildIdf(anchors);
  const start = Math.max(0, currentIndex < 0 || global ? 0 : currentIndex - lookback);
  const end = Math.min(
    anchors.length - 1,
    currentIndex < 0 || global ? anchors.length - 1 : currentIndex + lookahead
  );

  const candidates = [];
  for (let index = start; index <= end; index += 1) {
    const anchor = anchors[index];
    const own = orderedMatchScore(anchor.tokens, heard, idf);
    const previousTokens = index > 0 ? anchors[index - 1].tokens : [];
    const context = orderedMatchScore([...previousTokens, ...anchor.tokens], heard, idf);
    // Previous-line evidence helps distinguish repeated choruses, but the line
    // itself remains the dominant signal and must satisfy the overlap floor.
    const contextBonus =
      own.overlap > 0 ? Math.max(0, context.weighted - own.weighted) * 0.5 : 0;
    // Forward prior: reward staying or stepping forward one, penalise jumps and
    // backward moves. During recovery, keep the prior light enough to relock.
    let prior = 0;
    if (currentIndex >= 0) {
      const step = index - currentIndex;
      if (global) prior = -0.08 * Math.abs(step);
      else if (step < 0) prior = -3;
      else if (step === 0) prior = 0.8;
      else if (step === 1) prior = 0.5;
      else prior = -0.45 * (step - 1);
    }
    candidates.push({
      index,
      score: own.weighted + contextBonus + prior,
      overlap: own.overlap,
      weighted: own.weighted,
      contextBonus,
      text: anchor.text
    });
  }

  candidates.sort((a, b) => {
    const scoreDifference = b.score - a.score;
    if (Math.abs(scoreDifference) > 1e-9) return scoreDifference;
    if (currentIndex < 0) return a.index - b.index;
    return Math.abs(a.index - currentIndex) - Math.abs(b.index - currentIndex);
  });
  const best = candidates[0];
  const second = candidates[1];

  let committedIndex = -1;
  if (best) {
    const availableWords = new Set(anchors[best.index].tokens).size;
    const requiredOverlap = Math.min(minOverlap, Math.max(1, availableWords));
    const beatsRunnerUp = !second || best.score - second.score >= margin;
    if (best.overlap >= requiredOverlap && beatsRunnerUp) committedIndex = best.index;
  }

  return { committedIndex, candidates };
}

// Weighted longest-common-subsequence alignment. Unlike a bag of words, this
// rewards lyric words in their sung order and still tolerates omissions.
function orderedMatchScore(candidateTokens, heardTokens, idf) {
  let previous = Array.from({ length: heardTokens.length + 1 }, () => ({ weighted: 0, overlap: 0 }));

  for (const token of candidateTokens) {
    const current = [{ weighted: 0, overlap: 0 }];
    for (let heardIndex = 1; heardIndex <= heardTokens.length; heardIndex += 1) {
      const fromCandidateSkip = previous[heardIndex];
      const fromHeardSkip = current[heardIndex - 1];
      let best = betterAlignment(fromCandidateSkip, fromHeardSkip);
      const weight = wordMatchWeight(token, heardTokens[heardIndex - 1]);
      if (weight > 0) {
        const diagonal = previous[heardIndex - 1];
        // A rolling transcript describes a path through the lyrics. Weight its
        // final words more heavily so the selected line is where the singer is
        // now, rather than the line at the beginning of the audio window.
        const recency = 0.6 + heardIndex / heardTokens.length;
        const matched = {
          weighted: diagonal.weighted + (0.55 + idf(token)) * weight * recency,
          overlap: diagonal.overlap + 1
        };
        best = betterAlignment(best, matched);
      }
      current.push(best);
    }
    previous = current;
  }

  return previous[heardTokens.length] || { weighted: 0, overlap: 0 };
}

function betterAlignment(first, second) {
  if (second.weighted > first.weighted + 1e-9) return second;
  if (Math.abs(second.weighted - first.weighted) <= 1e-9 && second.overlap > first.overlap) {
    return second;
  }
  return first;
}

// Does a line word match anything heard? Exact first, then a capped edit-distance
// check so Whisper mishearings ("canal" vs "canel", "gasworks" vs "gas works")
// still count, at a discount.
export function matchWord(token, heardSet, heardList) {
  if (heardSet.has(token)) return { matched: true, weight: 1 };
  for (const heardWord of heardList) {
    const weight = wordMatchWeight(token, heardWord);
    if (weight > 0) return { matched: true, weight };
  }
  return { matched: false, weight: 0 };
}

function wordMatchWeight(token, heardWord) {
  if (token === heardWord) return 1;
  // A one-letter edit changes most of a very short word (me/be, go/no), so
  // fuzzy matching there creates far more false positives than recoveries.
  if (token.length <= 3 || heardWord.length <= 3) return 0;
  const maxDistance = token.length >= 8 && heardWord.length >= 8 ? 2 : 1;
  if (Math.abs(heardWord.length - token.length) > maxDistance) return 0;
  return boundedLevenshtein(token, heardWord, maxDistance) <= maxDistance ? 0.6 : 0;
}

// Levenshtein distance with an early exit once the best possible score on a row
// exceeds the cap. Returns cap + 1 when the true distance is beyond the cap.
export function boundedLevenshtein(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowBest) rowBest = current[j];
    }
    if (rowBest > cap) return cap + 1;
    previous = current;
  }
  return previous[b.length];
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// Hook the debug-panel sliders up to the live tuning object. Changing the step
// rate restarts the transcription timer; the rest take effect on the next cycle.
function wireTuningControls(ui, followState, onStepChange) {
  const format = (key, value) => {
    if (key === "windowSeconds") return `${value.toFixed(1)}s`;
    if (key === "stepMs") return `${value}ms`;
    if (key === "margin") return value.toFixed(1);
    return String(value);
  };
  ui.panel.querySelectorAll("[data-tune]").forEach((input) => {
    const key = input.dataset.tune;
    const label = ui.panel.querySelector(`[data-knob="${key}"]`);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      followState.tuning[key] = value;
      if (label) label.textContent = format(key, value);
      if (key === "stepMs") onStepChange();
    });
  });
}

// Treat phones/tablets as memory-constrained. Covers iPadOS, which reports a
// desktop user agent but still has mobile memory limits, via touch points.
function isMobileDevice() {
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  const touchMac = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return touchMac || window.matchMedia("(max-width: 820px)").matches;
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
  panel.className = "follow-debug hidden collapsed";
  panel.innerHTML = `
    <button type="button" class="follow-debug-head" data-collapse aria-expanded="false">
      <span>Follow mode (debug)</span><span class="follow-collapse-icon">&#9660;</span>
    </button>
    <div class="follow-debug-body">
      <div class="follow-row"><span>Model</span>
        <select data-model>${DESKTOP_MODELS.map(
          (m) => `<option value="${m.id}"${m.id === MODEL_DESKTOP ? " selected" : ""}>${m.label}</option>`
        ).join("")}</select>
      </div>
      <div class="follow-row"><span>Status</span><div data-status>idle</div></div>
      <div class="follow-row"><span>Anchors</span><div data-anchor-count>0 lyric lines</div></div>
      <div class="follow-row"><span>Heard</span><div data-heard>-</div></div>
      <div class="follow-row"><span>Candidates</span><div data-candidates></div></div>
      <div class="follow-tuning">
        <div class="follow-tuning-title">Tuning</div>
        <label class="follow-knob">Window <span data-knob="windowSeconds">4.0s</span>
          <input type="range" data-tune="windowSeconds" min="2" max="8" step="0.5" value="4"></label>
        <label class="follow-knob">Step <span data-knob="stepMs">1000ms</span>
          <input type="range" data-tune="stepMs" min="500" max="2500" step="100" value="1000"></label>
        <label class="follow-knob">Recent words <span data-knob="heardTail">7</span>
          <input type="range" data-tune="heardTail" min="3" max="12" step="1" value="7"></label>
        <label class="follow-knob">Min words <span data-knob="minOverlap">2</span>
          <input type="range" data-tune="minOverlap" min="1" max="4" step="1" value="2"></label>
        <label class="follow-knob">Margin <span data-knob="margin">1.0</span>
          <input type="range" data-tune="margin" min="0" max="4" step="0.5" value="1"></label>
      </div>
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
    candidates: panel.querySelector("[data-candidates]"),
    modelSelect: panel.querySelector("[data-model]")
  };
}

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .follow-toggle { margin-left: 8px; }
    .follow-toggle.is-active { outline: 2px solid currentColor; }
    .follow-current-line { background: rgba(255, 215, 0, 0.22); border-radius: 4px; }
    .follow-debug {
      position: fixed; left: 12px; bottom: 84px; width: 300px; z-index: 30;
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
    .follow-debug select {
      width: 100%; font: inherit; padding: 2px 4px; border-radius: 4px;
      color: #f4f4f5; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
    }
    .follow-debug select option { color: #111; }
    .follow-tuning { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.15); }
    .follow-tuning-title { opacity: 0.6; margin-bottom: 4px; }
    .follow-knob { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 6px; margin: 3px 0; }
    .follow-knob input { grid-column: 1 / -1; width: 100%; margin: 0; }
    .follow-knob span { opacity: 0.85; font-variant-numeric: tabular-nums; }
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
