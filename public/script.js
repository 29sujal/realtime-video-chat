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
let peers = {};
let isMuted = false;
let usingFront = true;

// Generate random room ID
function genRoomId(len = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// Create room
createBtn.addEventListener("click", () => {
  roomInput.value = genRoomId();
});

// Join room
joinBtn.addEventListener("click", async () => {
  roomId = roomInput.value.trim();
  if (!roomId) return alert("Please enter or create a room ID");

  joinScreen.classList.add("hidden");
  videoScreen.classList.remove("hidden");
  roomDisplay.innerText = `Room: ${roomId}`;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    alert("Camera/Mic access denied: " + err.message);
    return;
  }

  addLocalVideoTile(localStream);
  socket.emit("join-room", roomId);
});

// Copy room link
copyLinkBtn.addEventListener("click", () => {
  const url = `${location.origin}${location.pathname}?room=${roomId}`;
  navigator.clipboard.writeText(url);
  copyLinkBtn.innerText = "Copied!";
  setTimeout(() => (copyLinkBtn.innerText = "Copy Room Link"), 1200);
});

// Mute/unmute
muteBtn.addEventListener("click", () => {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => (t.enabled = !isMuted));
  muteBtn.innerHTML = isMuted
    ? '<i class="fas fa-microphone-slash"></i>'
    : '<i class="fas fa-microphone"></i>';
});

// Switch camera
switchBtn.addEventListener("click", async () => {
  usingFront = !usingFront;
  await switchCamera(usingFront ? "user" : "environment");
});

// Hang up
hangupBtn.addEventListener("click", () => {
  Object.values(peers).forEach(p => p.peer.destroy());
  peers = {};
  videosDiv.innerHTML = "";
  localStream?.getTracks().forEach(t => t.stop());
  socket.emit("disconnect");
  videoScreen.classList.add("hidden");
  joinScreen.classList.remove("hidden");
  roomInput.value = "";
});

// SOCKET LISTENERS
socket.on("user-joined", otherId => {
  createPeer(otherId, true);
});
socket.on("signal", data => {
  const { from, signal } = data;
  if (!peers[from]) createPeer(from, false, signal);
  else peers[from].peer.signal(signal);
});
socket.on("user-left", id => removePeer(id));

// PEER CREATION
function createPeer(remoteId, initiator, incomingSignal = null) {
  const peer = new SimplePeer({
    initiator,
    trickle: false,
    stream: localStream,
    config: {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    },
  });

  const tile = createVideoTile(`user-${remoteId}`, false);

  peer.on("signal", signal => socket.emit("signal", { to: remoteId, signal }));
  peer.on("stream", stream => {
    attachStreamToTile(tile, stream);
    adjustLayout();
  });
  peer.on("close", () => removePeer(remoteId));
  peer.on("error", () => removePeer(remoteId));

  peers[remoteId] = { peer, el: tile };
  if (!initiator && incomingSignal) peer.signal(incomingSignal);
  adjustLayout();
}

// VIDEO TILE FUNCTIONS
function createVideoTile(id, isLocal) {
  const div = document.createElement("div");
  div.className = `video-tile ${isLocal ? "local" : "remote"}`;
  div.id = id;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal;
  div.appendChild(video);

  const label = document.createElement("div");
  label.className = "label";
  label.innerText = isLocal ? "You" : "Remote";
  div.appendChild(label);

  div.addEventListener("dblclick", swapVideos);
  videosDiv.appendChild(div);
  return div;
}

function attachStreamToTile(tile, stream) {
  const vid = tile.querySelector("video");
  vid.srcObject = stream;
}

function addLocalVideoTile(stream) {
  const tile = createVideoTile("local", true);
  attachStreamToTile(tile, stream);
  adjustLayout();
}

// REMOVE PEER
function removePeer(id) {
  const rec = peers[id];
  if (!rec) return;
  rec.peer.destroy();
  rec.el.remove();
  delete peers[id];
  adjustLayout();
}

// LAYOUT ADJUSTMENT
function adjustLayout() {
  const count = Object.keys(peers).length + (localStream ? 1 : 0);
  const tiles = videosDiv.querySelectorAll(".video-tile");

  if (count === 2) {
    videosDiv.classList.remove("group");
    tiles.forEach(tile => {
      if (tile.classList.contains("local")) {
        tile.style.position = "absolute";
        tile.style.width = "30%";
        tile.style.height = "25%";
        tile.style.bottom = "16px";
        tile.style.right = "16px";
      } else {
        tile.style.position = "relative";
        tile.style.width = "100%";
        tile.style.height = "100%";
      }
    });
  } else {
    videosDiv.classList.add("group");
    tiles.forEach(tile => {
      tile.style.position = "relative";
      tile.style.width = "100%";
      tile.style.height = "100%";
    });
  }
}

// DOUBLE TAP SWAP
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

// SWITCH CAMERA
async function switchCamera(facingMode) {
  if (!localStream) return;
  const newStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode },
    audio: true,
  });
  const newTrack = newStream.getVideoTracks()[0];
  const audioTrack = localStream.getAudioTracks()[0];
  localStream = new MediaStream([newTrack, audioTrack]);

  const localTile = document.getElementById("local");
  attachStreamToTile(localTile, localStream);

  Object.values(peers).forEach(({ peer }) => {
    if (peer.replaceTrack)
      peer.replaceTrack(peer.streams[0].getVideoTracks()[0], newTrack, localStream);
  });
}

// PREFILL ROOM FROM URL
(function () {
  const params = new URLSearchParams(window.location.search);
  const r = params.get("room");
  if (r) roomInput.value = r;
})();
