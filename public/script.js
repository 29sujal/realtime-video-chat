// public/script.js
const socket = io("https://realtime-video-chat-o9gq.onrender.com");
const joinBtn = document.getElementById("joinBtn");
const createBtn = document.getElementById("createBtn");
const roomInput = document.getElementById("roomInput");
const joinScreen = document.getElementById("join-screen");
const videoScreen = document.getElementById("video-screen");
const videosDiv = document.getElementById("videos");
const roomDisplay = document.getElementById("roomDisplay");
const muteBtn = document.getElementById("muteBtn");
const switchBtn = document.getElementById("switchBtn");
const hangupBtn = document.getElementById("hangupBtn");
const copyLinkBtn = document.getElementById("copyLink");

let roomId = null;
let localStream = null;
let peers = {}; // { peerId: { peer, el(video element) } }
let isMuted = false;
let usingFront = true; // front camera initially (facingMode: 'user')

// Utility: generate short room ID
function genRoomId(len = 6) {
  const s = "abcdefghijklmnopqrstuvwxyz0123456789";
  let r = "";
  for (let i = 0; i < len; i++) r += s[Math.floor(Math.random() * s.length)];
  return r;
}

// Create room
createBtn.addEventListener("click", () => {
  roomInput.value = genRoomId(6);
});

// Join room
joinBtn.addEventListener("click", async () => {
  roomId = (roomInput.value || "").trim();
  if (!roomId) {
    alert("Please enter or create a room ID");
    return;
  }

  joinScreen.classList.add("hidden");
  videoScreen.classList.remove("hidden");
  roomDisplay.innerText = `Room: ${roomId}`;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: true,
    });
  } catch (err) {
    alert("Camera/Microphone access required: " + err.message);
    return;
  }

  addLocalVideoTile(localStream);
  socket.emit("join-room", roomId);
});

// Copy link
copyLinkBtn?.addEventListener("click", () => {
  const url = `${location.origin}${location.pathname}?room=${roomId}`;
  navigator.clipboard.writeText(url).then(() => {
    copyLinkBtn.innerText = "Copied!";
    setTimeout(() => (copyLinkBtn.innerText = "Copy Room Link"), 1200);
  });
});

// Mute/unmute
muteBtn?.addEventListener("click", () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
  muteBtn.innerText = isMuted ? "🔇" : "🔈";
});

// Switch camera
switchBtn?.addEventListener("click", async () => {
  usingFront = !usingFront;
  await switchCamera(usingFront ? "user" : "environment");
});

// Hang up
hangupBtn?.addEventListener("click", () => {
  Object.values(peers).forEach((p) => p.peer.destroy());
  peers = {};
  videosDiv.innerHTML = "";
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  socket.emit("disconnect");
  videoScreen.classList.add("hidden");
  joinScreen.classList.remove("hidden");
  roomInput.value = "";
});

// Socket listeners
socket.on("user-joined", (otherId) => {
  console.log("user-joined", otherId);
  createPeer(otherId, true);
});

socket.on("signal", (data) => {
  const { from, signal } = data;
  if (!peers[from]) {
    createPeer(from, false, signal);
  } else {
    peers[from].peer.signal(signal);
  }
});

socket.on("user-left", (id) => {
  removePeer(id);
});

// ==================== PEER CREATION ====================
function createPeer(remoteId, initiator, incomingSignal = null) {
  if (!localStream) {
    console.warn("no local stream yet");
    return;
  }

  const peer = new SimplePeer({
    initiator,
    trickle: false,
    stream: localStream,
  });

  const tile = createVideoTile(`user-${remoteId}`, false);

  peer.on("signal", (signal) => {
    socket.emit("signal", { to: remoteId, signal });
  });

  peer.on("stream", (stream) => {
    attachStreamToTile(tile, stream);
    adjustLayout();
  });

  peer.on("close", () => removePeer(remoteId));
  peer.on("error", (e) => {
    console.warn("peer error", e);
    removePeer(remoteId);
  });

  peers[remoteId] = { peer, el: tile };
  if (!initiator && incomingSignal) peer.signal(incomingSignal);
  adjustLayout();
  return peer;
}

// Remove peer
function removePeer(id) {
  const rec = peers[id];
  if (!rec) return;
  try {
    rec.peer.destroy();
  } catch (e) {}
  if (rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
  delete peers[id];
  adjustLayout();
}

// ==================== CREATE VIDEO TILE ====================
function createVideoTile(id, isLocal) {
  const wrapper = document.createElement("div");
  wrapper.className = `video-tile ${isLocal ? "local" : "remote"}`;
  wrapper.id = id;

  const vid = document.createElement("video");
  vid.autoplay = true;
  vid.playsInline = true;
  vid.muted = isLocal ? true : false;
  wrapper.appendChild(vid);

  const lbl = document.createElement("div");
  lbl.className = "label";
  lbl.innerText = isLocal ? "You" : "Remote";
  wrapper.appendChild(lbl);

  // Double-click to swap (WhatsApp style)
  wrapper.addEventListener("dblclick", swapVideos);

  videosDiv.appendChild(wrapper);
  return wrapper;
}

// ==================== ATTACH STREAM ====================
function attachStreamToTile(tile, stream) {
  const video = tile.querySelector("video");
  video.srcObject = stream;
  video.addEventListener("loadedmetadata", () =>
    video.play().catch(() => {})
  );
}

// ==================== ADD LOCAL VIDEO ====================
function addLocalVideoTile(stream) {
  const tile = createVideoTile("local", true);
  attachStreamToTile(tile, stream);
  adjustLayout();
}

// ==================== LAYOUT MANAGEMENT ====================
function adjustLayout() {
  const count = Object.keys(peers).length + (localStream ? 1 : 0);

  if (count === 2) {
    videosDiv.className = "videos-grid";
    const tiles = videosDiv.querySelectorAll(".video-tile");
    tiles.forEach((t) => {
      if (t.id === "local") {
        t.className = "video-tile local";
      } else {
        t.className = "video-tile remote";
      }
    });
  } else {
    // Group calls layout
    videosDiv.className = "videos-grid group";
    const tiles = videosDiv.querySelectorAll(".video-tile");
    tiles.forEach((t) => {
      t.className = "video-tile";
      t.style.position = "relative";
    });
  }
}

// ==================== DOUBLE-TAP SWAP LOGIC ====================
function swapVideos() {
  const local = document.querySelector(".video-tile.local");
  const remote = document.querySelector(".video-tile.remote");

  if (!local || !remote) return;

  local.classList.toggle("local");
  local.classList.toggle("remote");
  remote.classList.toggle("local");
  remote.classList.toggle("remote");

  adjustLayout();
}

// ==================== FULLSCREEN HELPER ====================
function requestFullScreen(el) {
  if (el.requestFullscreen) el.requestFullscreen();
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else if (el.msRequestFullscreen) el.msRequestFullscreen();
}

// ==================== SWITCH CAMERA ====================
async function switchCamera(facingMode) {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode },
      audio: true,
    });
    const newTrack = newStream.getVideoTracks()[0];

    localStream.getTracks().forEach((t) => {
      if (t.kind === "video") t.stop();
    });

    const audioTrack =
      newStream.getAudioTracks()[0] || localStream.getAudioTracks()[0];
    localStream = new MediaStream([newTrack, audioTrack]);

    const localTile = document.getElementById("local");
    if (localTile) attachStreamToTile(localTile, localStream);

    Object.values(peers).forEach(({ peer }) => {
      if (typeof peer.replaceTrack === "function") {
        try {
          peer.replaceTrack(videoTrack, newTrack, localStream);
        } catch (e) {
          console.warn("replaceTrack failed", e);
        }
      } else {
        try {
          peer.destroy();
        } catch (e) {}
      }
    });

    socket.emit("join-room", roomId);
  } catch (err) {
    console.error("switchCamera error", err);
    alert("Cannot switch camera: " + err.message);
  }
}

// ==================== ON LOAD ====================
(function prefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const r = params.get("room");
  if (r) roomInput.value = r;
})();

window.addEventListener("beforeunload", () => {
  if (localStream) localStream.getTracks().forEach((t) => t.stop());
});
