// DOM Elements
const sidebar = document.getElementById('sidebar');
const chatArea = document.getElementById('chat-area');
const menuBtn = document.getElementById('menu-btn');
const mobileCloseSidebar = document.getElementById('mobile-close-sidebar');

// Modals
const termsModal = document.getElementById('terms-modal-overlay');
const profileModal = document.getElementById('profile-modal-overlay');
const settingsModal = document.getElementById('settings-modal-overlay');
const callModal = document.getElementById('call-modal');
const reactionPopup = document.getElementById('reaction-popup');

// Setup UI
const agreeBtn = document.getElementById('agree-btn');
const setupAvatarInput = document.getElementById('setup-avatar-input');
const setupAvatarPreview = document.getElementById('setup-avatar-preview');
const setupNameInput = document.getElementById('setup-name-input');
const setupIdInput = document.getElementById('setup-id-input');
const saveProfileBtn = document.getElementById('save-profile-btn');
const setupError = document.getElementById('setup-error');

// Profile Display
const myAvatar = document.getElementById('my-avatar');
const myName = document.getElementById('my-name');
const myCustomId = document.getElementById('my-custom-id');
const copyBtn = document.getElementById('copy-btn');
const openSettingsBtn = document.getElementById('open-settings-btn');

// Settings UI
const settingImoTyping = document.getElementById('setting-imo-typing');
const settingTextSize = document.getElementById('setting-text-size');
const settingSelfDestruct = document.getElementById('setting-self-destruct');
const inputWallpaper = document.getElementById('input-wallpaper');
const btnWallpaper = document.getElementById('btn-wallpaper');
const btnExportChat = document.getElementById('btn-export-chat');
const btnClearHistory = document.getElementById('btn-clear-history');

// Connection UI
const peerIdInput = document.getElementById('peer-id-input');
const connectBtn = document.getElementById('connect-btn');
const connectionStatus = document.getElementById('connection-status');
const roomStatus = document.getElementById('room-status');
const disconnectBtn = document.getElementById('disconnect-btn');

// Chat UI
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const voiceBtn = document.getElementById('voice-btn');
const liveTypingDisplay = document.getElementById('live-typing-display');
const headerTyping = document.getElementById('header-typing');

// Search & Reply UI
const searchBtn = document.getElementById('search-btn');
const searchBox = document.getElementById('search-box');
const searchInput = document.getElementById('search-input');
const closeSearchBtn = document.getElementById('close-search-btn');
const replyPreview = document.getElementById('reply-preview');
const replyToName = document.getElementById('reply-to-name');
const replyToText = document.getElementById('reply-to-text');
const closeReplyBtn = document.getElementById('close-reply-btn');

// Audio Elements
const soundMsgIn = document.getElementById('sound-msg-in');
const soundMsgOut = document.getElementById('sound-msg-out');
const soundRing = document.getElementById('sound-ring');

// State
let myProfile = { name: '', avatar: '', customId: '' };
let settings = { imoTyping: false, selfDestruct: false };
let peer = null;
let connections = {};
let isHost = false;
let currentReplyToMsgId = null;

// Initialization
async function initApp() {
    const agreed = localStorage.getItem('ghostchat_agreed');
    if (!agreed) {
        termsModal.classList.remove('hidden');
    } else {
        await loadProfileAndSettings();
    }
}

agreeBtn.addEventListener('click', () => {
    localStorage.setItem('ghostchat_agreed', 'true');
    termsModal.classList.add('hidden');
    profileModal.classList.remove('hidden');
});

// Profile Setup
setupAvatarPreview.addEventListener('click', () => setupAvatarInput.click());
setupAvatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            myProfile.avatar = e.target.result;
            setupAvatarPreview.innerHTML = `<img src="${myProfile.avatar}">`;
        };
        reader.readAsDataURL(file);
    }
});

saveProfileBtn.addEventListener('click', async () => {
    const name = setupNameInput.value.trim();
    const id = setupIdInput.value.trim().toLowerCase();
    
    if (!name || !id) {
        setupError.textContent = "Name and ID are required.";
        setupError.classList.remove('hidden');
        return;
    }
    if (id.includes(' ')) {
        setupError.textContent = "ID cannot contain spaces.";
        setupError.classList.remove('hidden');
        return;
    }

    myProfile.name = name;
    myProfile.customId = id;
    if (!myProfile.avatar) {
        myProfile.avatar = document.getElementById('my-avatar').src; // default
    }

    localStorage.setItem('ghostchat_profile', JSON.stringify(myProfile));
    profileModal.classList.add('hidden');
    await startPeerServer();
});

async function loadProfileAndSettings() {
    const saved = localStorage.getItem('ghostchat_profile');
    if (!saved) {
        profileModal.classList.remove('hidden');
        return;
    }
    myProfile = JSON.parse(saved);
    updateProfileUI();

    // Load Settings
    const s = localStorage.getItem('ghostchat_settings');
    if (s) {
        settings = JSON.parse(s);
        settingImoTyping.checked = settings.imoTyping;
        settingSelfDestruct.checked = settings.selfDestruct;
    }
    const bg = localStorage.getItem('ghostchat_bg');
    if (bg) document.body.style.setProperty('--chat-bg-img', `url(${bg})`);
    
    const ts = localStorage.getItem('ghostchat_textsize');
    if (ts) {
        settingTextSize.value = ts;
        document.body.setAttribute('data-text-size', ts);
    }

    await loadChatHistory();
    await startPeerServer();
}

function updateProfileUI() {
    myAvatar.src = myProfile.avatar;
    myName.textContent = myProfile.name;
    myCustomId.textContent = myProfile.customId;
}

// PeerJS Networking
async function startPeerServer() {
    setupError.classList.add('hidden');
    
    // Try to connect with custom ID
    peer = new Peer(myProfile.customId, { debug: 1 });

    peer.on('open', (id) => {
        updateProfileUI();
    });

    peer.on('error', (err) => {
        console.error("PeerJS Error:", err);
        if (err.type === 'unavailable-id') {
            alert(`The username '${myProfile.customId}' is currently taken on the network. Please choose another one in settings or clear browser cache.`);
            profileModal.classList.remove('hidden');
            setupError.textContent = "ID is taken. Choose another.";
            setupError.classList.remove('hidden');
        } else {
            connectionStatus.textContent = 'Network error: ' + err.type;
        }
    });

    peer.on('connection', (connection) => {
        isHost = true;
        setupConnection(connection);
    });
}

function setupConnection(connection) {
    connection.on('open', () => {
        connections[connection.peer] = connection;
        updateRoomStatus();
        
        // Send our profile info so they know who we are
        connection.send({ type: 'profile-sync', profile: myProfile });

        addSystemMessage(`${connection.peer} connected.`);
        
        // Broadcast join to others
        if (isHost && Object.keys(connections).length > 1) {
            broadcastMessage({ type: 'system', content: `${connection.peer} joined.` }, connection.peer);
        }
    });

    connection.on('data', (data) => {
        handleIncomingData(data, connection.peer);
    });

    connection.on('close', () => {
        delete connections[connection.peer];
        updateRoomStatus();
        addSystemMessage(`${connection.peer} left.`);
        if (isHost) broadcastMessage({ type: 'system', content: `${connection.peer} left.` });
    });
}

connectBtn.addEventListener('click', () => {
    const targetId = peerIdInput.value.trim().toLowerCase();
    if (!targetId || targetId === myProfile.customId) return;

    connectionStatus.textContent = 'Connecting...';
    const connection = peer.connect(targetId, { reliable: true });
    isHost = false;
    setupConnection(connection);
});

function updateRoomStatus() {
    const count = Object.keys(connections).length;
    if (count > 0) {
        connectionStatus.textContent = `Connected to ${count} peer(s)`;
        connectionStatus.style.color = 'var(--success)';
        roomStatus.textContent = `Connected: ${count} Peer(s)`;
    } else {
        connectionStatus.textContent = 'Not connected';
        connectionStatus.style.color = 'var(--text-muted)';
    }
}

// Data Handling
let peerProfiles = {}; // Map of peerId -> Profile

function handleIncomingData(data, senderId) {
    if (data.type === 'profile-sync') {
        peerProfiles[senderId] = data.profile;
        if (!isHost) {
            // Send mine back
            connections[senderId].send({ type: 'profile-sync', profile: myProfile });
        }
        return;
    }

    if (data.type === 'read-receipt') {
        const tick = document.getElementById(`tick-${data.msgId}`);
        if (tick) tick.classList.add('read');
        return;
    }
    
    if (data.type === 'typing') {
        headerTyping.textContent = `${peerProfiles[senderId]?.name || senderId} is typing...`;
        headerTyping.classList.remove('hidden');
        clearTimeout(headerTyping.timeout);
        headerTyping.timeout = setTimeout(() => headerTyping.classList.add('hidden'), 2000);
        return;
    }

    if (data.type === 'live-typing') {
        if (!settings.imoTyping) return;
        if (data.content === '') liveTypingDisplay.classList.add('hidden');
        else {
            liveTypingDisplay.classList.remove('hidden');
            liveTypingDisplay.textContent = `${peerProfiles[senderId]?.name || senderId}: ${data.content}`;
        }
        return;
    }

    if (data.type === 'delete-msg') {
        const msgEl = document.getElementById(`msg-${data.msgId}`);
        if (msgEl) {
            msgEl.innerHTML = `<em>🚫 Message deleted</em>`;
        }
        deleteFromHistory(data.msgId);
        return;
    }
    
    if (data.type === 'reaction') {
        const badgeContainer = document.getElementById(`react-${data.msgId}`);
        if (badgeContainer) {
            badgeContainer.textContent = data.emoji;
            badgeContainer.classList.remove('hidden');
        }
        return;
    }

    // Message Rendering
    const senderName = peerProfiles[senderId]?.name || senderId;
    renderMessage(data, 'received', senderName);
    
    // Play sound if tab is active or not
    soundMsgIn.play().catch(e=>{});
    
    // Blink Tab
    if (document.hidden) {
        document.title = "(🔔) New Message - GhostChat";
    }

    // Read Receipt
    if (data.msgId && document.hasFocus()) {
        connections[senderId].send({ type: 'read-receipt', msgId: data.msgId });
    }

    // Host Broadcast
    if (isHost && data.type !== 'system') {
        broadcastMessage(data, senderId);
    }
}

function broadcastMessage(data, exclude = null) {
    Object.values(connections).forEach(c => {
        if (c.peer !== exclude && c.open) c.send(data);
    });
}

window.addEventListener('focus', () => {
    document.title = "GhostChat V5 - Absolute Privacy";
    // Send read receipts for all unread visible messages if needed (simplified here)
});

// Messaging
messageInput.addEventListener('input', () => {
    const text = messageInput.value;
    
    // Resize textarea
    messageInput.style.height = 'auto';
    messageInput.style.height = (messageInput.scrollHeight) + 'px';

    if (text.trim().length > 0) {
        sendBtn.classList.remove('hidden');
        voiceBtn.classList.add('hidden');
    } else {
        sendBtn.classList.add('hidden');
        voiceBtn.classList.remove('hidden');
    }

    // Regular typing indicator
    broadcastMessage({ type: 'typing' });

    // Live typing (IMO style)
    if (settings.imoTyping) {
        broadcastMessage({ type: 'live-typing', content: text });
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

sendBtn.addEventListener('click', sendMessage);

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || Object.keys(connections).length === 0) return;

    const msgId = Math.random().toString(36).substr(2, 9);
    const payload = {
        type: 'text', content: text, msgId, 
        replyTo: currentReplyToMsgId,
        selfDestruct: settings.selfDestruct
    };
    
    broadcastMessage(payload);
    renderMessage(payload, 'sent', 'Me');
    
    soundMsgOut.play().catch(e=>{});

    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.classList.add('hidden');
    voiceBtn.classList.remove('hidden');
    if (settings.imoTyping) broadcastMessage({ type: 'live-typing', content: '' });
    
    closeReplyPreview();
    
    // Save to local history
    await saveToHistory(payload, 'sent', 'Me');
}

// Rendering UI
function renderMessage(data, alignment, senderName) {
    if (data.type === 'system') {
        const div = document.createElement('div');
        div.className = 'message system';
        div.textContent = data.content;
        messagesContainer.appendChild(div);
        scrollToBottom();
        return;
    }

    const div = document.createElement('div');
    div.className = `message ${alignment}`;
    div.id = `msg-${data.msgId}`;
    
    // Sender Name
    if (alignment === 'received') {
        const nameEl = document.createElement('div');
        nameEl.className = 'sender-name';
        nameEl.textContent = senderName;
        div.appendChild(nameEl);
    }

    // Reply Block
    if (data.replyTo) {
        const rb = document.createElement('div');
        rb.className = 'reply-block';
        rb.textContent = "Replied to a message";
        rb.onclick = () => {
            const target = document.getElementById(`msg-${data.replyTo}`);
            if (target) target.scrollIntoView({behavior: 'smooth'});
        };
        div.appendChild(rb);
    }

    // Content
    if (data.type === 'text') {
        const span = document.createElement('span');
        span.textContent = data.content;
        div.appendChild(span);
    } else if (data.type === 'image') {
        const img = document.createElement('img');
        img.src = data.content;
        div.appendChild(img);
    } else if (data.type === 'video') {
        const vid = document.createElement('video');
        vid.src = data.content; vid.controls = true;
        div.appendChild(vid);
    } else if (data.type === 'audio') {
        const aud = document.createElement('audio');
        aud.src = data.content; aud.controls = true;
        div.appendChild(aud);
    }

    // Meta & Ticks
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    
    if (data.selfDestruct) {
        const sdIcon = document.createElement('span');
        sdIcon.innerHTML = '💣';
        meta.appendChild(sdIcon);
        
        // Start destruction timer for received
        if (alignment === 'received') {
            setTimeout(() => {
                div.innerHTML = `<em>🚫 Message self-destructed</em>`;
                deleteFromHistory(data.msgId);
            }, 10000);
        }
    }
    
    const time = document.createElement('span');
    const now = new Date(data.timestamp || Date.now());
    time.textContent = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
    meta.appendChild(time);
    
    if (alignment === 'sent') {
        const tick = document.createElement('span');
        tick.className = 'tick';
        tick.id = `tick-${data.msgId}`;
        tick.innerHTML = '✓✓';
        meta.appendChild(tick);
    }
    div.appendChild(meta);

    // Reactions Container
    const reactBadge = document.createElement('div');
    reactBadge.className = 'reaction-badge hidden';
    reactBadge.id = `react-${data.msgId}`;
    div.appendChild(reactBadge);

    // Actions (Reply/React/Delete)
    let actionTimer;
    div.addEventListener('pointerdown', (e) => {
        actionTimer = setTimeout(() => {
            showReactionMenu(e, data.msgId, alignment);
        }, 500); // long press
    });
    div.addEventListener('pointerup', () => clearTimeout(actionTimer));
    div.addEventListener('pointerleave', () => clearTimeout(actionTimer));

    messagesContainer.appendChild(div);
    scrollToBottom();
    
    if (alignment === 'received' && !data.fromHistory) {
        saveToHistory(data, 'received', senderName);
    }
}

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Reactions & Context Menu
let activeContextMsgId = null;
function showReactionMenu(e, msgId, alignment) {
    activeContextMsgId = msgId;
    reactionPopup.style.top = (e.clientY - 40) + 'px';
    reactionPopup.style.left = Math.min(e.clientX, window.innerWidth - 150) + 'px';
    
    // Add Reply & Delete buttons dynamically to reaction popup
    let html = `
        <span class="emoji" onclick="sendReaction('👍')">👍</span>
        <span class="emoji" onclick="sendReaction('❤️')">❤️</span>
        <span class="emoji" onclick="sendReaction('😂')">😂</span>
        <div style="border-left:1px solid var(--primary); margin-left:5px; padding-left:10px; display:flex; gap:10px; align-items:center;">
            <i class="fa-solid fa-reply" style="cursor:pointer; color:var(--primary)" onclick="replyTo('${msgId}')"></i>
    `;
    if (alignment === 'sent') {
        html += `<i class="fa-solid fa-trash" style="cursor:pointer; color:var(--danger)" onclick="deleteForEveryone('${msgId}')"></i>`;
    }
    html += `</div>`;
    
    reactionPopup.innerHTML = html;
    reactionPopup.classList.remove('hidden');
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.message') && !e.target.closest('.reaction-popup')) {
        reactionPopup.classList.add('hidden');
    }
});

function sendReaction(emoji) {
    if (!activeContextMsgId) return;
    const payload = { type: 'reaction', emoji, msgId: activeContextMsgId };
    broadcastMessage(payload);
    handleIncomingData(payload, myProfile.customId); // Self update
    reactionPopup.classList.add('hidden');
}

function replyTo(msgId) {
    currentReplyToMsgId = msgId;
    replyPreview.classList.remove('hidden');
    messageInput.focus();
    reactionPopup.classList.add('hidden');
}

closeReplyBtn.addEventListener('click', closeReplyPreview);
function closeReplyPreview() {
    currentReplyToMsgId = null;
    replyPreview.classList.add('hidden');
}

function deleteForEveryone(msgId) {
    const payload = { type: 'delete-msg', msgId };
    broadcastMessage(payload);
    handleIncomingData(payload, myProfile.customId);
    reactionPopup.classList.add('hidden');
}

// Settings Menu
document.getElementById('open-settings-btn').addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
});
document.getElementById('close-settings-btn').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    
    // Save settings
    settings.imoTyping = settingImoTyping.checked;
    settings.selfDestruct = settingSelfDestruct.checked;
    localStorage.setItem('ghostchat_settings', JSON.stringify(settings));
    
    const ts = settingTextSize.value;
    document.body.setAttribute('data-text-size', ts);
    localStorage.setItem('ghostchat_textsize', ts);
});

btnWallpaper.addEventListener('click', () => inputWallpaper.click());
inputWallpaper.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const bg = e.target.result;
            document.body.style.setProperty('--chat-bg-img', `url(${bg})`);
            localStorage.setItem('ghostchat_bg', bg);
        };
        reader.readAsDataURL(file);
    }
});

// Mobile Sidebar
menuBtn.addEventListener('click', () => sidebar.classList.add('open'));
mobileCloseSidebar.addEventListener('click', () => sidebar.classList.remove('open'));
chatArea.addEventListener('click', (e) => {
    if(window.innerWidth <= 768 && !e.target.closest('.menu-btn')) {
        sidebar.classList.remove('open');
    }
});

// Copy
copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(myProfile.customId).then(() => {
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
        setTimeout(() => copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i>', 2000);
    });
});

// Chat History (IndexedDB via localForage)
localforage.config({ name: 'GhostChatV5', storeName: 'messages' });

async function saveToHistory(msgData, alignment, senderName) {
    if (msgData.selfDestruct) return; // Don't save destructing msgs
    const clone = { ...msgData, alignment, senderName, timestamp: Date.now() };
    
    let history = await localforage.getItem('chat_history') || [];
    history.push(clone);
    await localforage.setItem('chat_history', history);
}

async function loadChatHistory() {
    let history = await localforage.getItem('chat_history') || [];
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    
    // Filter old messages
    history = history.filter(m => (now - m.timestamp) < oneDay);
    await localforage.setItem('chat_history', history);
    
    history.forEach(m => {
        m.fromHistory = true;
        renderMessage(m, m.alignment, m.senderName);
    });
}

async function deleteFromHistory(msgId) {
    let history = await localforage.getItem('chat_history') || [];
    history = history.filter(m => m.msgId !== msgId);
    await localforage.setItem('chat_history', history);
}

btnClearHistory.addEventListener('click', async () => {
    await localforage.removeItem('chat_history');
    messagesContainer.innerHTML = '';
    addSystemMessage('History cleared.');
    settingsModal.classList.add('hidden');
});

// Export Chat
btnExportChat.addEventListener('click', async () => {
    const history = await localforage.getItem('chat_history') || [];
    let text = "GhostChat V5 History\n\n";
    history.forEach(m => {
        const d = new Date(m.timestamp).toLocaleString();
        if(m.type === 'text') text += `[${d}] ${m.senderName}: ${m.content}\n`;
        else text += `[${d}] ${m.senderName}: [${m.type.toUpperCase()} SENT]\n`;
    });
    
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `GhostChat_Export_${Date.now()}.txt`;
    a.click();
});

initApp();
