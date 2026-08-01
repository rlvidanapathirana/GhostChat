// Media, Calls, and Search Logic for V5

// Search UI
searchBtn.addEventListener('click', () => {
    searchBox.classList.remove('hidden');
    searchInput.focus();
});
closeSearchBtn.addEventListener('click', () => {
    searchBox.classList.add('hidden');
    searchInput.value = '';
    removeHighlights();
});
searchInput.addEventListener('input', () => {
    const term = searchInput.value.toLowerCase();
    removeHighlights();
    if (!term) return;
    
    const msgs = messagesContainer.querySelectorAll('.message span');
    msgs.forEach(msg => {
        if (msg.textContent.toLowerCase().includes(term)) {
            msg.parentElement.style.border = '2px solid var(--primary)';
        }
    });
});
function removeHighlights() {
    const msgs = messagesContainer.querySelectorAll('.message');
    msgs.forEach(msg => {
        if (msg.classList.contains('received')) msg.style.border = '1px solid var(--glass-border)';
        else msg.style.border = 'none';
    });
}

// File Upload with Progress (Mocked for chunking visualization)
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || Object.keys(connections).length === 0) return;
    if (file.size > 50 * 1024 * 1024) { alert('File too large (Max 50MB).'); return; }

    const uploadProgress = document.getElementById('upload-progress');
    const uploadBar = document.getElementById('upload-bar');
    uploadProgress.classList.remove('hidden');
    uploadBar.style.width = '0%';

    const reader = new FileReader();
    reader.onprogress = (event) => {
        if (event.lengthComputable) {
            const percentLoaded = Math.round((event.loaded / event.total) * 100);
            uploadBar.style.width = percentLoaded + '%';
        }
    };
    reader.onload = (event) => {
        uploadBar.style.width = '100%';
        setTimeout(() => uploadProgress.classList.add('hidden'), 500);

        const base64 = event.target.result;
        const msgId = Math.random().toString(36).substr(2, 9);
        let type = file.type.startsWith('image/') ? 'image' : (file.type.startsWith('video/') ? 'video' : null);
        if (!type) return;

        const payload = { type, content: base64, msgId, selfDestruct: settings.selfDestruct };
        broadcastMessage(payload);
        renderMessage(payload, 'sent', 'Me');
        saveToHistory(payload, 'sent', 'Me');
    };
    reader.readAsDataURL(file);
});

// Voice Messaging & Visualizer
const voiceVisualizer = document.getElementById('voice-visualizer');
const canvasCtx = voiceVisualizer.getContext('2d');
let audioCtx, analyser, dataArray;
let animFrame;

voiceBtn.addEventListener('pointerdown', startVoiceRecord);
voiceBtn.addEventListener('pointerup', stopVoiceRecord);
voiceBtn.addEventListener('pointerleave', stopVoiceRecord);

async function startVoiceRecord(e) {
    e.preventDefault();
    if (Object.keys(connections).length === 0) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        // Setup Visualizer
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 256;
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        voiceVisualizer.classList.remove('hidden');
        drawVisualizer();
        
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            cancelAnimationFrame(animFrame);
            voiceVisualizer.classList.add('hidden');
            if (audioCtx) audioCtx.close();

            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = (event) => {
                const base64 = event.target.result;
                const msgId = Math.random().toString(36).substr(2, 9);
                const payload = { type: 'audio', content: base64, msgId, selfDestruct: settings.selfDestruct };
                broadcastMessage(payload);
                renderMessage(payload, 'sent', 'Me');
                saveToHistory(payload, 'sent', 'Me');
            };
            reader.readAsDataURL(audioBlob);
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        voiceBtn.classList.add('recording');
    } catch (err) {
        alert('Microphone required.');
    }
}

function drawVisualizer() {
    animFrame = requestAnimationFrame(drawVisualizer);
    analyser.getByteFrequencyData(dataArray);
    canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    canvasCtx.fillRect(0, 0, voiceVisualizer.width, voiceVisualizer.height);
    const barWidth = (voiceVisualizer.width / dataArray.length) * 2.5;
    let x = 0;
    for(let i = 0; i < dataArray.length; i++) {
        const barHeight = dataArray[i] / 2;
        canvasCtx.fillStyle = '#10b981'; // Primary Green
        canvasCtx.fillRect(x, voiceVisualizer.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
    }
}

function stopVoiceRecord(e) {
    e.preventDefault();
    if (isRecording && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        isRecording = false;
        voiceBtn.classList.remove('recording');
    }
}

// Calls & Screen Sharing
const screenshareBtn = document.getElementById('screenshare-btn');
let screenStream = null;

async function makeCall(videoEnabled) {
    const peerIds = Object.keys(connections);
    if (peerIds.length === 0) { alert('Connect first!'); return; }
    const targetPeer = peerIds[0];

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: videoEnabled, audio: true });
        document.getElementById('local-video').srcObject = localStream;
        document.getElementById('local-video').style.display = videoEnabled ? 'block' : 'none';
        
        document.getElementById('call-title').textContent = videoEnabled ? 'Calling...' : 'Calling (Audio)...';
        document.getElementById('call-caller-name').textContent = targetPeer;
        callModal.classList.remove('hidden');
        acceptCallBtn.classList.add('hidden');
        
        // Ring sound out
        soundRing.play().catch(e=>{});

        currentCall = peer.call(targetPeer, localStream);
        currentCall.on('stream', (remoteStream) => {
            soundRing.pause(); soundRing.currentTime = 0;
            document.getElementById('remote-video').srcObject = remoteStream;
            document.getElementById('call-title').textContent = 'In Call';
        });
        currentCall.on('close', endCall);
    } catch (err) {
        alert('Camera/Mic access denied.');
    }
}

audioCallBtn.addEventListener('click', () => makeCall(false));
videoCallBtn.addEventListener('click', () => makeCall(true));

// Peer incoming call event is in app.js
function handleIncomingCall(call) {
    currentCall = call;
    document.getElementById('call-title').textContent = 'Incoming Call...';
    document.getElementById('call-caller-name').textContent = call.peer;
    callModal.classList.remove('hidden');
    acceptCallBtn.classList.remove('hidden');
    soundRing.play().catch(e=>{});
    call.on('close', endCall);
}

// Replace peer.on('call') in app.js if needed, or simply map it:
peer.on('call', handleIncomingCall);

acceptCallBtn.addEventListener('click', async () => {
    soundRing.pause(); soundRing.currentTime = 0;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local-video').srcObject = localStream;
        currentCall.answer(localStream);
        currentCall.on('stream', (remoteStream) => {
            document.getElementById('remote-video').srcObject = remoteStream;
        });
        acceptCallBtn.classList.add('hidden');
        document.getElementById('call-title').textContent = 'In Call';
    } catch (err) {
        currentCall.close();
    }
});

endCallBtn.addEventListener('click', () => {
    soundRing.pause(); soundRing.currentTime = 0;
    if (currentCall) currentCall.close();
    endCall();
});

screenshareBtn.addEventListener('click', async () => {
    if (!currentCall || !localStream) return;
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        
        // Replace track in peer connection
        const sender = currentCall.peerConnection.getSenders().find(s => s.track.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
        
        document.getElementById('local-video').srcObject = screenStream;
        screenshareBtn.style.background = 'var(--primary)';

        videoTrack.onended = () => {
            // Revert to camera
            const camTrack = localStream.getVideoTracks()[0];
            if (sender) sender.replaceTrack(camTrack);
            document.getElementById('local-video').srcObject = localStream;
            screenshareBtn.style.background = 'rgba(255,255,255,0.2)';
        };
    } catch (err) {
        console.error("Screen share failed", err);
    }
});
