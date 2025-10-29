// -------------------- SOCKET & ELEMENT SETUP --------------------
const socket = io("https://realtime-video-chat-o9gq.onrender.com");
const videosContainer = document.getElementById("videos");
const joinScreen = document.getElementById("join-screen");
const videoScreen = document.getElementById("video-screen");
const roomInput = document.getElementById("roomInput");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const roomDisplay = document.getElementById("roomDisplay");
const copyLink = document.getElementById("copyLink");
const muteBtn = document.getElementById("muteBtn");
const hangupBtn = document.getElementById("hangupBtn");
const switchBtn = document.getElementById("switchBtn");

let localStream;
let peers = {};
let currentRoom = null;
let usingFront = true;
let muted = false;

// -------------------- JOIN / CREATE ROOM --------------------
createBtn.onclick = async () => {
  const roomId = Math.floor(Math.random() * 1000).toString();
  await startRoom(roomId);
};

joinBtn.onclick = async () => {
  const roomId = roomInput.value.trim();
  if (!roomId) return alert("Enter a room ID to join!");
  await startRoom(roomId);
};

async function startRoom(roomId) {
  currentRoom = roomId;
  roomDisplay.innerText = `Room: ${roomId}`;
  joinScreen.classList.add("hidden");
  videoScreen.classList.remove("hidden");
  await initMedia();
  socket.emit("join-room", roomId);
}

copyLink.onclick = () => {
  navigator.clipboard.writeText(window.location.href + "?room=" + currentRoom);
  alert("Room link copied!");
};

// -------------------- MEDIA SETUP --------------------
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: true,
    });
    addVideoTile("local", localStream, "You");
  } catch (err) {
    alert("Camera/Mic access denied.");
    console.error(err);
  }
}

function addVideoTile(id, stream, label = "") {
  let videoWrapper = document.createElement("div");
  videoWrapper.className = "video-tile";
  videoWrapper.id = `tile-${id}`;

  let video = document.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = id === "local";
  video.srcObject = stream;

  let name = document.createElement("p");
  name.textContent = label;
  name.className = "username";

  videoWrapper.appendChild(video);
  videoWrapper.appendChild(name);
  videosContainer.appendChild(videoWrapper);
}

function attachStreamToTile(tile, stream) {
  const video = tile.querySelector("video");
  if (video) video.srcObject = stream;
}

// -------------------- SOCKET EVENTS --------------------
socket.on("user-joined", userId => {
  console.log("User joined:", userId);
  const peer = createPeer(userId, true);
  peers[userId] = { peer };
});

socket.on("signal", async data => {
  let peer = peers[data.from]?.peer;
  if (!peer) {
    peer = createPeer(data.from, false);
    peers[data.from] = { peer };
  }
  peer.signal(data.signal);
});

socket.on("user-left", id => {
  console.log("User left:", id);
  const tile = document.getElementById(`tile-${id}`);
  if (tile) tile.remove();
  if (peers[id]) {
    peers[id].peer.destroy();
    delete peers[id];
  }
});

// -------------------- PEER CONNECTION --------------------
function createPeer(remoteId, initiator) {
  const peer = new SimplePeer({
    initiator,
    stream: localStream,
    trickle: false,
  });

  peer.on("signal", data => {
    socket.emit("signal", { to: remoteId, signal: data });
  });

  peer.on("stream", stream => {
    console.log("Stream received from:", remoteId);
    if (!document.getElementById(`tile-${remoteId}`)) {
      addVideoTile(remoteId, stream, "Friend");
    }
  });

  peer.on("close", () => {
    console.log("Peer closed:", remoteId);
    const tile = document.getElementById(`tile-${remoteId}`);
    if (tile) tile.remove();
  });

  return peer;
}

// -------------------- CAMERA SWITCH --------------------
switchBtn.addEventListener("click", async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const hasBackCam = devices.some(
    d => d.kind === "videoinput" && d.label.toLowerCase().includes("back")
  );

  usingFront = !usingFront;
  const mode = hasBackCam ? (usingFront ? "user" : "environment") : "user";
  await switchCamera(mode);
});

async function switchCamera(facingMode) {
  if (!localStream) return;

  const overlay = document.createElement("div");
  overlay.innerText = "Switching camera...";
  Object.assign(overlay.style, {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    background: "rgba(0,0,0,0.6)",
    padding: "15px 30px",
    borderRadius: "10px",
    color: "#fff",
    zIndex: "9999",
  });
  document.body.appendChild(overlay);

  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode },
      audio: true,
    });
    const newVideoTrack = newStream.getVideoTracks()[0];

    // Stop old video tracks
    localStream.getVideoTracks().forEach(track => track.stop());

    // Update localStream and preview
    localStream.removeTrack(localStream.getVideoTracks()[0]);
    localStream.addTrack(newVideoTrack);
    const localTile = document.getElementById("tile-local");
    attachStreamToTile(localTile, localStream);

    // Replace video tracks for all peers
    Object.values(peers).forEach(({ peer }) => {
      const sender = peer._pc
        .getSenders()
        .find(s => s.track && s.track.kind === "video");
      if (sender) sender.replaceTrack(newVideoTrack);
    });
  } catch (err) {
    console.error("Camera switch failed:", err);
  } finally {
    setTimeout(() => overlay.remove(), 1000);
  }
}

// -------------------- MUTE / HANGUP --------------------
muteBtn.onclick = () => {
  if (!localStream) return;
  muted = !muted;
  localStream.getAudioTracks().forEach(track => (track.enabled = !muted));
  muteBtn.innerHTML = muted
    ? '<i class="fas fa-microphone-slash"></i>'
    : '<i class="fas fa-microphone"></i>';
};

hangupBtn.onclick = () => {
  Object.values(peers).forEach(({ peer }) => peer.destroy());
  peers = {};
  videosContainer.innerHTML = "";
  socket.disconnect();
  location.reload();
};

