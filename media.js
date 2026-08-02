/* ══════════════════════════════════════════
   GhostChat V6 — media.js (Calls & Voice)
   ══════════════════════════════════════════ */

// ─── Voice Recording ───
let mediaRecorder=null, audioChunks=[], isRecording=false;
let audioCtx=null, analyser=null, animFrame=null;

const voiceBtn  = document.getElementById('voice-btn');
const voiceCanvas = document.getElementById('voice-canvas');
const canvasCtx = voiceCanvas.getContext('2d');

voiceBtn.addEventListener('pointerdown', startRec);
voiceBtn.addEventListener('pointerup',   stopRec);
voiceBtn.addEventListener('pointerleave',stopRec);

async function startRec(e) {
    e.preventDefault();
    if (Object.keys(connections).length===0) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
        audioCtx = new (window.AudioContext||window.webkitAudioContext)();
        analyser  = audioCtx.createAnalyser();
        const src = audioCtx.createMediaStreamSource(stream);
        src.connect(analyser);
        analyser.fftSize=256;
        const dataArr=new Uint8Array(analyser.frequencyBinCount);
        voiceCanvas.classList.remove('hidden');
        (function draw(){
            animFrame=requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArr);
            canvasCtx.fillStyle='rgba(0,0,0,.85)';
            canvasCtx.fillRect(0,0,voiceCanvas.width,voiceCanvas.height);
            const bw=(voiceCanvas.width/dataArr.length)*2.5;
            let x=0;
            for (let i=0;i<dataArr.length;i++) {
                const bh=dataArr[i]/2;
                canvasCtx.fillStyle='#10b981';
                canvasCtx.fillRect(x,voiceCanvas.height-bh,bw,bh);
                x+=bw+1;
            }
        })();

        mediaRecorder=new MediaRecorder(stream);
        audioChunks=[];
        mediaRecorder.ondataavailable=e=>audioChunks.push(e.data);
        mediaRecorder.onstop=()=>{
            cancelAnimationFrame(animFrame);
            voiceCanvas.classList.add('hidden');
            audioCtx?.close();
            stream.getTracks().forEach(t=>t.stop());
            
            if (cancelRecording) {
                audioChunks = [];
                cancelRecording = false;
                return;
            }
            
            const blob=new Blob(audioChunks,{type:'audio/webm'});
            const r=new FileReader();
            r.onload=ev=>{
                const msgId=uid();
                const payload={type:'audio',content:ev.target.result,msgId,selfDestruct:settings.selfDestruct,timestamp:Date.now()};
                broadcast(payload);
                renderMsg(payload,'sent','Me',currentPeerId);
                if (currentPeerId) saveToHistory(currentPeerId,payload,'sent','Me');
                updateContact(currentPeerId,{lastMsg:'🎤 Voice message',lastTime:Date.now()});
                renderChatList();
            };
            r.readAsDataURL(blob);
        };
        mediaRecorder.start();
        isRecording=true;
        voiceBtn.classList.add('recording');
        document.getElementById('voice-cancel-btn').classList.remove('hidden');
    } catch(err) { alert('Microphone access required.'); }
}

let cancelRecording = false;

document.getElementById('voice-cancel-btn').onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isRecording) {
        cancelRecording = true;
        stopRec(e);
    }
};

function stopRec(e) {
    e.preventDefault();
    if (isRecording && mediaRecorder?.state!=='inactive') {
        mediaRecorder.stop();
        isRecording=false;
        voiceBtn.classList.remove('recording');
        document.getElementById('voice-cancel-btn').classList.add('hidden');
    }
}

// ─── Calls ───
let currentCall=null, localStream=null, isMuted=false, isCamOff=false;
const callScreen     = document.getElementById('call-screen');
const remoteVideo    = document.getElementById('remote-video');
const localVideo     = document.getElementById('local-video');
const callAudioBg    = document.getElementById('call-audio-bg');
const callBigAvatar  = document.getElementById('call-big-avatar');
const callPeerNameEl = document.getElementById('call-peer-name-el');
const callStateEl    = document.getElementById('call-state-el');
const endCallBtn     = document.getElementById('end-call-btn');
const acceptCallBtn  = document.getElementById('accept-call-btn');
const btnMute        = document.getElementById('btn-mute');
const btnCam         = document.getElementById('btn-cam-toggle');
const btnScreen      = document.getElementById('btn-screenshare');
const btnFlipCam     = document.getElementById('btn-flip-cam');
const btnSpeaker     = document.getElementById('btn-speaker');

// Attach header call buttons (chat screen)
document.getElementById('audio-call-btn').onclick=()=>makeCall(currentPeerId,'audio');
document.getElementById('video-call-btn').onclick=()=>makeCall(currentPeerId,'video');

async function makeCall(peerId, type) {
    if (!peerId||!connections[peerId]?.open) { alert('No active connection.'); return; }
    try {
        localStream=await navigator.mediaDevices.getUserMedia({ video:type==='video', audio:true });
        showCallScreen(peerId, type, false);
        localVideo.srcObject=localStream;
        localVideo.style.display = type==='video' ? 'block':'none';
        document.getElementById('sound-ring').play().catch(()=>{});
        currentCall=peer.call(peerId, localStream);
        currentCall.on('stream', remoteStream=>{
            document.getElementById('sound-ring').pause();
            document.getElementById('sound-ring').currentTime=0;
            remoteVideo.srcObject=remoteStream;
            callAudioBg.style.display = type==='video'?'none':'flex';
            callStateEl.textContent='In call';
        });
        currentCall.on('close', endCall);
        addCallLog(peerId, type, 'out');
    } catch(e) { alert('Camera/mic denied.'); }
}

function handleIncomingCall(call) {
    currentCall=call;
    const peerId=call.peer;
    showCallScreen(peerId, 'video', true);
    document.getElementById('sound-ring').play().catch(()=>{});
    call.on('close', endCall);
    addCallLog(peerId, 'video', 'in');
}

acceptCallBtn.onclick=async()=>{
    document.getElementById('sound-ring').pause();
    document.getElementById('sound-ring').currentTime=0;
    try {
        localStream=await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
        localVideo.srcObject=localStream;
        currentCall.answer(localStream);
        currentCall.on('stream', s=>{ remoteVideo.srcObject=s; callAudioBg.style.display='none'; callStateEl.textContent='In call'; });
        acceptCallBtn.classList.add('hidden');
        callStateEl.textContent='In call';
    } catch(e) { currentCall.close(); }
};

endCallBtn.onclick=()=>{ document.getElementById('sound-ring').pause(); currentCall?.close(); endCall(); };

function showCallScreen(peerId, type, incoming) {
    const p=peerProfiles[peerId]||contacts[peerId]||{};
    callPeerNameEl.textContent=p.name||peerId;
    callStateEl.textContent=incoming?'Incoming call...':'Calling...';
    callAudioBg.style.display='flex';
    callBigAvatar.innerHTML=p.avatar?`<img src="${p.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`:'<i class="fa-solid fa-user"></i>';
    remoteVideo.srcObject=null;
    localVideo.srcObject=null;
    callScreen.classList.remove('hidden');
    acceptCallBtn.classList.toggle('hidden',!incoming);
    btnMute.classList.remove('hidden');
    btnCam.classList.remove('hidden');
    btnScreen.classList.remove('hidden');
}

function endCall() {
    localStream?.getTracks().forEach(t=>t.stop());
    localStream=null; currentCall=null;
    remoteVideo.srcObject=null; localVideo.srcObject=null;
    callScreen.classList.add('hidden');
    document.getElementById('sound-ring').pause();
    document.getElementById('sound-ring').currentTime=0;
    sysMsg('Call ended.');
}

// Mute
btnMute.onclick=()=>{
    if (!localStream) return;
    isMuted=!isMuted;
    localStream.getAudioTracks().forEach(t=>t.enabled=!isMuted);
    btnMute.classList.toggle('active',isMuted);
    btnMute.innerHTML=isMuted?'<i class="fa-solid fa-microphone-slash"></i>':'<i class="fa-solid fa-microphone"></i>';
};

// Camera Toggle
btnCam.onclick=()=>{
    if (!localStream) return;
    isCamOff=!isCamOff;
    localStream.getVideoTracks().forEach(t=>t.enabled=!isCamOff);
    btnCam.classList.toggle('active',isCamOff);
    btnCam.innerHTML=isCamOff?'<i class="fa-solid fa-video-slash"></i>':'<i class="fa-solid fa-video"></i>';
};

// Screen Share
btnScreen.onclick=async()=>{
    if (!currentCall) return;
    try {
        const scrStream=await navigator.mediaDevices.getDisplayMedia({ video:true });
        const track=scrStream.getVideoTracks()[0];
        const sender=currentCall.peerConnection?.getSenders().find(s=>s.track?.kind==='video');
        if (sender) sender.replaceTrack(track);
        localVideo.srcObject=scrStream;
        btnScreen.classList.add('active');
        track.onended=()=>{
            const camTrack=localStream?.getVideoTracks()[0];
            if (sender&&camTrack) sender.replaceTrack(camTrack);
            localVideo.srcObject=localStream;
            btnScreen.classList.remove('active');
        };
    } catch(e) { console.warn('Screen share cancelled'); }
};

// Flip Camera (Front/Back)
let currentFacingMode = 'user';
btnFlipCam.onclick = async () => {
    if (!currentCall || !localStream) return;
    try {
        currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
        const newStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: { exact: currentFacingMode } }, 
            audio: false 
        });
        const newVideoTrack = newStream.getVideoTracks()[0];
        
        // Stop old video track
        localStream.getVideoTracks().forEach(t => t.stop());
        localStream.removeTrack(localStream.getVideoTracks()[0]);
        localStream.addTrack(newVideoTrack);
        
        // Replace in PeerConnection
        const sender = currentCall.peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(newVideoTrack);
        
        localVideo.srcObject = localStream;
    } catch (err) {
        console.warn('Cannot switch camera. Falling back...', err);
        currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
        alert('Camera switch not supported on this device.');
    }
};

// Speaker Toggle (Earpiece vs Loudspeaker)
let usingLoudspeaker = true;
btnSpeaker.onclick = async () => {
    if (typeof remoteVideo.setSinkId !== 'function') {
        alert('Speaker switching is not supported by your browser (Requires Chrome/Android).');
        return;
    }
    
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
        if (audioOutputs.length < 2) {
            alert('Only one audio output device found.');
            return;
        }
        
        // Very basic toggle logic, picking next device. 
        // Mobile Chrome usually exposes 'default' (earpiece) and 'speaker' (loudspeaker).
        usingLoudspeaker = !usingLoudspeaker;
        const targetLabel = usingLoudspeaker ? 'speaker' : 'default'; // heuristic
        
        let targetDevice = audioOutputs.find(d => d.label.toLowerCase().includes(targetLabel));
        if (!targetDevice) targetDevice = audioOutputs[usingLoudspeaker ? 1 : 0]; // fallback
        
        await remoteVideo.setSinkId(targetDevice.deviceId);
        btnSpeaker.classList.toggle('active', !usingLoudspeaker); // active when earpiece (muted speaker icon effect)
        sysMsg(`Audio routed to ${usingLoudspeaker ? 'Loudspeaker' : 'Earpiece'}`);
    } catch (err) {
        console.error('Error switching speaker:', err);
    }
};
