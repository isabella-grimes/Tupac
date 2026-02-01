const coin   = document.getElementById("coin");
const scene  = document.getElementById("scene");
const shadow = document.getElementById("shadow");

const result = document.getElementById("result");
const btnFlip  = document.getElementById("btnFlip");
const btnReset = document.getElementById("btnReset");

const soundToggle = document.getElementById("soundToggle");

const clientSeedInput = document.getElementById("clientSeed");
const btnNewClientSeed = document.getElementById("btnNewClientSeed");

const serverHashEl = document.getElementById("serverHash");
const serverSeedRevealEl = document.getElementById("serverSeedReveal");
const btnVerify = document.getElementById("btnVerify");
const verifyStatus = document.getElementById("verifyStatus");

const historyBody = document.getElementById("historyBody");

// ---------------------------
// State
// ---------------------------
let busy = false;
let showing = 0; // 0 heads, 1 tails
let currentY = 0;
let nonce = 0;

let serverSeed = "";
let serverHash = "";
let lastFlip = null;

// ---------------------------
// Helpers
// ---------------------------
function bytesToHex(bytes){
  return [...bytes].map(b => b.toString(16).padStart(2,"0")).join("");
}

function randomHex(byteLen = 32){
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

async function sha256Hex(text){
  const enc = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return bytesToHex(new Uint8Array(hash));
}

async function sha256Bytes(text){
  const enc = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return new Uint8Array(hash);
}

function u32FromFirst4Bytes(hashBytes){
  const view = new DataView(hashBytes.buffer, hashBytes.byteOffset, hashBytes.byteLength);
  return view.getUint32(0, false); // big-endian
}

function outcomeFromRoll(u32){
  // fair 50/50 split
  return (u32 % 2 === 0) ? 0 : 1; // 0 heads, 1 tails
}

function outcomeLabel(o){ return o === 0 ? "HEADS" : "TAILS"; }

function setResultText(text){
  result.textContent = text;
}

function ensureHistoryHeader(){
  if (historyBody.children.length === 1 && historyBody.children[0].children.length === 1){
    // remove "No flips yet." row
    historyBody.innerHTML = "";
  }
}

function addHistoryRow(entry){
  ensureHistoryHeader();

  const tr = document.createElement("tr");

  const tdN = document.createElement("td");
  tdN.textContent = entry.index;

  const tdO = document.createElement("td");
  tdO.textContent = outcomeLabel(entry.outcome);

  const tdNonce = document.createElement("td");
  tdNonce.textContent = String(entry.nonce);

  const tdRoll = document.createElement("td");
  tdRoll.textContent = String(entry.roll);

  const tdHash = document.createElement("td");
  tdHash.textContent = entry.resultHash;
  tdHash.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";
  tdHash.style.wordBreak = "break-all";

  tr.append(tdN, tdO, tdNonce, tdRoll, tdHash);
  historyBody.prepend(tr);

  // keep last 12
  while (historyBody.children.length > 12){
    historyBody.removeChild(historyBody.lastChild);
  }
}

// ---------------------------
// Provably fair commit/reveal
// ---------------------------
async function newServerCommit(){
  serverSeed = randomHex(32);
  serverHash = await sha256Hex(serverSeed);

  serverHashEl.textContent = serverHash;
  serverSeedRevealEl.textContent = "—";
  verifyStatus.textContent = "";
}

function getClientSeed(){
  return (clientSeedInput.value || "").trim();
}

function setClientSeed(v){
  clientSeedInput.value = v;
}

// ---------------------------
// Sound (WebAudio, no files)
// ---------------------------
let audioCtx = null;

function audioEnabled(){
  return soundToggle.checked;
}

function ensureAudio(){
  if (!audioEnabled()) return null;
  if (!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // resume if suspended (mobile)
  if (audioCtx.state === "suspended"){
    audioCtx.resume().catch(()=>{});
  }
  return audioCtx;
}

function playWhoosh(){
  const ctx = ensureAudio();
  if (!ctx) return;

  const now = ctx.currentTime;

  // noise buffer
  const bufferSize = Math.floor(ctx.sampleRate * 0.25);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i=0;i<bufferSize;i++){
    data[i] = (Math.random()*2 - 1) * (1 - i/bufferSize);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(700, now);
  filter.frequency.exponentialRampToValueAtTime(1200, now + 0.18);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.26);
}

function playClink(){
  const ctx = ensureAudio();
  if (!ctx) return;

  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(820, now);
  osc.frequency.exponentialRampToValueAtTime(440, now + 0.12);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.28, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.16);

  // small click
  const click = ctx.createOscillator();
  click.type = "square";
  click.frequency.setValueAtTime(1600, now);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.0001, now);
  g2.gain.exponentialRampToValueAtTime(0.12, now + 0.002);
  g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
  click.connect(g2).connect(ctx.destination);
  click.start(now);
  click.stop(now + 0.032);
}

// ---------------------------
// Real toss animation
// ---------------------------
function animateShadow(duration){
  shadow.animate(
    [
      { transform: shadow.style.transform || "translateY(calc(var(--coin-size) * .40)) scale(1)", opacity: 0.72, offset: 0 },
      { transform: "translateY(calc(var(--coin-size) * .40)) scale(0.62)", opacity: 0.28, offset: 0.45 },
      { transform: "translateY(calc(var(--coin-size) * .40)) scale(0.88)", opacity: 0.55, offset: 0.80 },
      { transform: "translateY(calc(var(--coin-size) * .40)) scale(1)", opacity: 0.72, offset: 1 }
    ],
    { duration, easing: "cubic-bezier(.2,.8,.2,1)" }
  );
}

function animateCoin(finalYDeg, duration){
  const up = -220;         // how high it goes
  const wobble = (Math.random() * 18 - 9).toFixed(2); // -9..+9
  const wobble2 = (Math.random() * 18 - 9).toFixed(2);

  // Start from currentY
  const startY = currentY;

  // Add some extra tilt during flight
  const midX1 = -25 + Math.random()*10;
  const midX2 = 18 - Math.random()*12;

  const anim = coin.animate(
    [
      { transform: `translateY(0px) rotateY(${startY}deg) rotateX(0deg)` , offset: 0 },
      { transform: `translateY(${up}px) rotateY(${startY + (finalYDeg-startY)*0.55}deg) rotateX(${midX1}deg)` , offset: 0.45 },
      { transform: `translateY(-110px) rotateY(${startY + (finalYDeg-startY)*0.78}deg) rotateX(${midX2}deg)` , offset: 0.75 },
      { transform: `translateY(0px) rotateY(${finalYDeg}deg) rotateX(${wobble}deg)` , offset: 0.92 },
      { transform: `translateY(0px) rotateY(${finalYDeg}deg) rotateX(${wobble2}deg)` , offset: 1 }
    ],
    { duration, easing: "cubic-bezier(.2,.85,.2,1)", fill: "forwards" }
  );

  anim.onfinish = () => {
    currentY = finalYDeg % 360;
    coin.style.transform = `translateY(0px) rotateY(${finalYDeg}deg) rotateX(${wobble2}deg)`;
  };

  return anim;
}

// ---------------------------
// Flip logic (provably fair)
// ---------------------------
async function flip(){
  if (busy) return;

  // Unlock audio on first user gesture
  ensureAudio();

  const clientSeed = getClientSeed();
  if (!clientSeed){
    setResultText("Please set a client seed first (or press Randomize).");
    return;
  }

  busy = true;
  setResultText("Flipping...");
  playWhoosh();

  // Use current serverSeed commitment
  nonce += 1;

  const input = `${serverSeed}:${clientSeed}:${nonce}`;
  const hashBytes = await sha256Bytes(input);
  const roll = u32FromFirst4Bytes(hashBytes);
  const outcome = outcomeFromRoll(roll); // 0 heads, 1 tails
  const resultHash = bytesToHex(hashBytes);

  // Decide final rotation
  const spins = 6 + Math.floor(Math.random()*3); // 6–8 full spins
  const targetFaceOffset = (outcome === 1) ? 180 : 0;

  // Make it “land” on correct face regardless of current showing:
  // If we're currently on tails and need heads, flip parity accordingly.
  const needDifferent = (outcome !== showing);
  const parityFix = needDifferent ? 180 : 0;

  const finalY = (spins * 360) + targetFaceOffset + parityFix;

  const duration = 1350 + Math.floor(Math.random()*250); // 1.35–1.6s
  animateShadow(duration);
  const anim = animateCoin(finalY, duration);

  // Save last flip info for verification
  lastFlip = {
    serverSeed,
    serverHash,
    clientSeed,
    nonce,
    input,
    roll,
    outcome,
    resultHash
  };

  anim.onfinish = async () => {
    showing = outcome;
    playClink();
    setResultText(`Result: ${outcomeLabel(outcome)}`);

    // Reveal used seed + allow verification
    serverSeedRevealEl.textContent = serverSeed;

    // Add to history UI
    addHistoryRow({
      index: nonce,
      outcome,
      nonce,
      roll,
      resultHash
    });

    // IMPORTANT: generate a NEW committed seed for next flip (like casinos)
    await newServerCommit();

    busy = false;
  };
}

async function verifyLastFlip(){
  if (!lastFlip){
    verifyStatus.textContent = "No flip yet.";
    return;
  }

  verifyStatus.textContent = "Verifying...";
  const computedHash = await sha256Hex(lastFlip.serverSeed);

  const okCommit = (computedHash === lastFlip.serverHash);

  const computedResultBytes = await sha256Bytes(lastFlip.input);
  const computedResultHash = bytesToHex(computedResultBytes);
  const computedRoll = u32FromFirst4Bytes(computedResultBytes);
  const computedOutcome = outcomeFromRoll(computedRoll);

  const okResult =
    computedResultHash === lastFlip.resultHash &&
    computedRoll === lastFlip.roll &&
    computedOutcome === lastFlip.outcome;

  if (okCommit && okResult){
    verifyStatus.textContent = "✅ Verified (commit + outcome).";
  } else {
    verifyStatus.textContent = "❌ Verification failed.";
  }
}

function reset(){
  busy = false;
  showing = 0;
  currentY = 0;
  nonce = 0;

  coin.getAnimations().forEach(a => a.cancel());
  shadow.getAnimations().forEach(a => a.cancel());

  coin.style.transform = "translateY(0px) rotateY(0deg) rotateX(0deg)";
  shadow.style.transform = "translateY(calc(var(--coin-size) * .40)) scale(1)";
  shadow.style.opacity = "0.72";

  historyBody.innerHTML = `<tr><td colspan="5" class="tiny">No flips yet.</td></tr>`;
  serverSeedRevealEl.textContent = "—";
  verifyStatus.textContent = "";

  setResultText("Ready.");
  newServerCommit();
}

// ---------------------------
// Init + events
// ---------------------------
function wireEvents(){
  scene.addEventListener("click", flip);
  btnFlip.addEventListener("click", flip);
  btnReset.addEventListener("click", reset);
  btnVerify.addEventListener("click", verifyLastFlip);

  scene.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " "){
      e.preventDefault();
      flip();
    }
  });

  btnNewClientSeed.addEventListener("click", () => {
    setClientSeed(randomHex(16));
  });
}

(async function init(){
  wireEvents();

  // default client seed
  setClientSeed(randomHex(16));

  // commit for first flip
  await newServerCommit();

  setResultText("Ready.");
})();
