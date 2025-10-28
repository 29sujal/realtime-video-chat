// public/script.js
const socket = io("https://realtime-video-chat-o9gq.onrender.com");
; // auto connects to same host
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
let peers = {};        // { peerId: { peer, el(video element) } }
let isMuted = false;
let usingFront = true; // front camera initially (facingMode: 'user')

// utility: generate short room id
function genRoomId(len = 6){
  const s = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let r = '';
  for(let i=0;i<len;i++) r += s[Math.floor(Math.random()*s.length)];
  return r;
}

// UI: create room
createBtn.addEventListener('click', ()=>{
  roomInput.value = genRoomId(6);
});

// Join
joinBtn.addEventListener('click', async ()=>{
  roomId = (roomInput.value || '').trim();
  if(!roomId) { alert('Please enter or create a room ID'); return; }

  // show UI
  joinScreen.classList.add('hidden');
  videoScreen.classList.remove('hidden');
  roomDisplay.innerText = `Room: ${roomId}`;

  // get media
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: 'user' }, audio:true });
  } catch(err){
    alert('Camera/Microphone access required: ' + err.message);
    return;
  }

  addLocalVideoTile(localStream);

  socket.emit('join-room', roomId);
});

// Copy link
copyLinkBtn?.addEventListener('click', ()=> {
  const url = `${location.origin}${location.pathname}?room=${roomId}`;
  navigator.clipboard.writeText(url).then(()=> {
    copyLinkBtn.innerText = 'Copied!';
    setTimeout(()=> copyLinkBtn.innerText = 'Copy Room Link', 1200);
  });
});

// call controls
muteBtn?.addEventListener('click', ()=> {
  if(!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  muteBtn.innerText = isMuted ? '🔇' : '🔈';
});

switchBtn?.addEventListener('click', async ()=> {
  // toggle facing mode
  usingFront = !usingFront;
  await switchCamera(usingFront ? 'user':'environment');
});

hangupBtn?.addEventListener('click', ()=> {
  // close everything and return to join screen
  Object.values(peers).forEach(p => p.peer.destroy());
  peers = {};
  videosDiv.innerHTML = '';
  if(localStream){
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  socket.emit('disconnect'); // notify server
  videoScreen.classList.add('hidden');
  joinScreen.classList.remove('hidden');
  roomInput.value = '';
});

// signaling: someone joined
socket.on('user-joined', async (otherId) => {
  console.log('user-joined', otherId);
  // create initiator peer
  createPeer(otherId, true);
});

// signaling: incoming signal
socket.on('signal', (data) => {
  const { from, signal } = data;
  if(!peers[from]) {
    // create a non-initiator and attach
    createPeer(from, false, signal);
  } else {
    peers[from].peer.signal(signal);
  }
});

// remote left
socket.on('user-left', (id) => {
  removePeer(id);
});

// create peer (using simple-peer)
function createPeer(remoteId, initiator, incomingSignal=null){
  if(!localStream){
    console.warn('no local stream yet');
    return;
  }

  const peer = new SimplePeer({
    initiator,
    trickle: false,
    stream: localStream
  });

  // create a tile for remote
  const tile = createVideoTile(`user-${remoteId}`, false);

  peer.on('signal', signal => {
    socket.emit('signal', { to: remoteId, signal });
  });

  peer.on('connect', () => {
    console.log('connected to', remoteId);
  });

  peer.on('stream', stream => {
    attachStreamToTile(tile, stream);
    adjustLayout();
  });

  peer.on('close', ()=> {
    removePeer(remoteId);
  });

  peer.on('error', (e)=> {
    console.warn('peer error', e);
    // try remove
    removePeer(remoteId);
  });

  // store
  peers[remoteId] = { peer, el: tile };

  // if we were created as responder and incomingSignal present, signal
  if(!initiator && incomingSignal) peer.signal(incomingSignal);

  adjustLayout();
  return peer;
}

// remove peer & UI
function removePeer(id){
  const rec = peers[id];
  if(!rec) return;
  try { rec.peer.destroy(); } catch(e){}
  if(rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
  delete peers[id];
  adjustLayout();
}

// create a tile element (returns tile element)
function createVideoTile(id, isLocal){
  const wrapper = document.createElement('div');
  wrapper.className = 'video-tile';
  wrapper.id = id;

  const vid = document.createElement('video');
  vid.autoplay = true;
  vid.playsInline = true;
  vid.muted = isLocal ? true : false;
  wrapper.appendChild(vid);

  const lbl = document.createElement('div');
  lbl.className = 'label';
  lbl.innerText = isLocal ? 'You' : 'Remote';
  wrapper.appendChild(lbl);

  // small controls
  const controls = document.createElement('div');
  controls.className = 'tile-controls';

  // fullscreen btn
  const fs = document.createElement('button');
  fs.title = 'Fullscreen';
  fs.innerText = '⤢';
  fs.addEventListener('click', ()=> {
    requestFullScreen(vid);
  });
  controls.appendChild(fs);

  wrapper.appendChild(controls);

  videosDiv.appendChild(wrapper);
  return wrapper;
}

// attach stream to tile
function attachStreamToTile(tile, stream){
  const video = tile.querySelector('video');
  video.srcObject = stream;
  // ensure layout update
  video.addEventListener('loadedmetadata', ()=> video.play().catch(()=>{}));
}

// add local tile
function addLocalVideoTile(stream){
  const tile = createVideoTile('local', true);
  attachStreamToTile(tile, stream);
  adjustLayout();
}

// layout adjuster
function adjustLayout(){
  const count = Object.keys(peers).length + (localStream ? 1 : 0);
  videosDiv.className = 'videos-grid'; // reset
  if(count === 2){
    // make exactly two behave like split-screen halves
    videosDiv.className = 'videos-grid two';
    // ensure videos are direct children videos
    // if tiles wrapper present, transform them to have video elements full
    const tiles = videosDiv.querySelectorAll('.video-tile');
    tiles.forEach(t => {
      t.style.borderRadius = '0';
    });
  } else {
    // many or one -> grid
    videosDiv.className = 'videos-grid';
    const tiles = videosDiv.querySelectorAll('.video-tile');
    tiles.forEach(t => {
      t.style.borderRadius = '10px';
    });
  }
}

// fullscreen helper
function requestFullScreen(el){
  if(el.requestFullscreen) el.requestFullscreen();
  else if(el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  else if(el.msRequestFullscreen) el.msRequestFullscreen();
}

// camera switch (attempts to replace tracks for each peer)
async function switchCamera(facingMode){
  if(!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0];
  // get new stream with requested facingMode
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode }, audio:true });
    const newTrack = newStream.getVideoTracks()[0];

    // replace local stream element
    localStream.getTracks().forEach(t => {
      if(t.kind === 'video') t.stop();
    });
    // keep audio track from newStream or reuse previous
    const audioTrack = newStream.getAudioTracks()[0] || localStream.getAudioTracks()[0];
    localStream = new MediaStream([newTrack, audioTrack]);
    // update local video element
    const localTile = document.getElementById('local');
    if(localTile) attachStreamToTile(localTile, localStream);

    // replace track on each peer (simple-peer exposes replaceTrack in many builds)
    Object.values(peers).forEach(({ peer }) => {
      // if replaceTrack supported
      if(typeof peer.replaceTrack === 'function'){
        try {
          peer.replaceTrack(videoTrack, newTrack, localStream);
        } catch(e){
          console.warn('replaceTrack failed, ignoring', e);
        }
      } else {
        // fallback: destroy & recreate (best-effort)
        try { peer.destroy(); } catch(e){}
      }
    });

    // for peers we destroyed as fallback, recreate them by rejoining signaling:
    // (a simple approach is to re-emit join so others will create peers for you)
    socket.emit('join-room', roomId);
  } catch(err){
    console.error('switchCamera error', err);
    alert('Cannot switch camera: ' + err.message);
  }
}

// when page loads, check if ?room=xxx present in url
(function prefillFromUrl(){
  const params = new URLSearchParams(window.location.search);
  const r = params.get('room');
  if(r) roomInput.value = r;
})();

// keep track of stream audio/video toggles when page closes
window.addEventListener('beforeunload', ()=> {
  if(localStream) localStream.getTracks().forEach(t=>t.stop());
});
