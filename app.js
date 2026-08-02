/* ══════════════════════════════════════════
   GhostChat V6 — app.js (Core Logic)
   Mobile-fixed build
   ══════════════════════════════════════════ */

// ─── State ───
let myProfile = { name:'', avatar:'', customId:'', status:'Hey there! I\'m on GhostChat 👻' };
let settings  = { imoTyping:false, selfDestruct:false };
let peer      = null;
let connections  = {};   // peerId → DataConnection
let peerProfiles = {};   // peerId → { name, avatar, status }
let currentPeerId = null; // who we're chatting with now
let isHost    = false;
let replyMsgId= null;
let contacts  = {};      // peerId → { name, avatar, status, lastMsg, lastTime, unread }
let callLog   = [];
let myStories = [];      // Array of { id, type, content, time }
let peerStories = {};    // peerId → [stories]

// ─── DB ───
localforage.config({ name:'GhostChatV6', storeName:'store' });

// ─── DOM shortcuts ───
const $ = id => document.getElementById(id);

// ─── Boot ───
async function boot() {
    await loadSettings();
    await loadContacts();
    await loadCallLog();
    await loadStories();
    
    // Check for Join URL
    const urlParams = new URLSearchParams(window.location.search);
    const joinId = urlParams.get('join');
    if (joinId) {
        setTimeout(() => {
            show('newchat-modal');
            $('newchat-peer-input').value = joinId;
        }, 1000);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const p = localStorage.getItem('gc_profile');
    if (p) {
        myProfile = JSON.parse(p);
        if (!myProfile.isGroup) myProfile.isGroup = false; // ensure prop exists
        applyProfileUI();
        startPeer();
    } else {
        show('profile-modal');
    }
}
boot();

$('agree-btn').onclick = () => {
    localStorage.setItem('gc_agreed','1');
    hide('terms-modal');
    show('profile-modal');
};

// ─── Profile Setup ───
$('setup-avatar-prev').onclick = () => $('setup-avatar-file').click();
$('setup-avatar-file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    readFile(f, d => {
        myProfile.avatar = d;
        $('setup-avatar-prev').innerHTML = `<img src="${d}">`;
    });
};
$('save-profile-btn').onclick = async () => {
    const name = $('setup-name').value.trim();
    const id   = $('setup-id').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
    const phone = $('setup-phone').value.trim();
    const email = $('setup-email').value.trim();
    const status=$('setup-status').value.trim() || myProfile.status;
    if (!name || !id) { showErr('setup-err','Fill in all fields.'); return; }
    if (!myProfile.avatar) myProfile.avatar = defaultAvatar();
    myProfile = { ...myProfile, name, customId:id, phone, email, status, isGroup: false, groupMembers: [] };
    localStorage.setItem('gc_profile', JSON.stringify(myProfile));
    hide('profile-modal');
    applyProfileUI();
    startPeer();
};

function applyProfileUI() {
    safeSet('hdr-avatar-img', el => { el.src = myProfile.avatar; });
    safeSet('my-status-avatar', el => { el.src = myProfile.avatar; });
    safeSet('my-status-text-display', el => { el.textContent = myProfile.status; });
}

// ─── 3-Dot Menu & Info Modals ───
$('home-settings-btn').onclick = (e) => {
    e.stopPropagation();
    $('home-dropdown').classList.toggle('hidden');
};
document.addEventListener('click', () => $('home-dropdown').classList.add('hidden'));

$('menu-settings').onclick = () => show('settings-modal');
$('menu-share-profile').onclick = () => {
    const link = window.location.origin + window.location.pathname + '?join=' + myProfile.customId;
    if (navigator.share) { 
        navigator.share({ title: 'Chat with me on GhostChat', text: 'Click this link to chat with me on GhostChat securely!', url: link }); 
    } else { 
        navigator.clipboard.writeText(link); 
        alert('Personal Invite Link copied to clipboard!\n\n' + link); 
    }
};
$('menu-about').onclick = () => {
    $('copyright-year').textContent = `© ${new Date().getFullYear()} RL GhostChat · V`;
    show('about-modal');
};
$('close-about-btn').onclick = () => hide('about-modal');

$('menu-terms').onclick = () => show('terms-modal-view');
$('close-terms-btn').onclick = () => hide('terms-modal-view');

// ─── Encryption Verification ───
$('chat-header-peer').onclick = () => {
    if (!currentPeerId) return;
    const peerCode = connections[currentPeerId]?.peer || currentPeerId;
    // Generate a simple hash of the peer ID to show as a "security code"
    let hash = 0;
    for (let i=0; i<peerCode.length; i++) { hash = (hash<<5)-hash+peerCode.charCodeAt(i); hash|=0; }
    const code = Math.abs(hash).toString().padStart(12, '0').replace(/(.{4})/g, '$1 ').trim();
    $('encryption-code-display').textContent = code;
    show('encryption-modal');
};
$('close-encryption-btn').onclick = () => hide('encryption-modal');

// ─── Account Edit ───
$('menu-account').onclick = () => {
    $('edit-name').value = myProfile.name;
    $('edit-username').value = myProfile.customId;
    $('edit-phone').value = myProfile.phone || '';
    $('edit-email').value = myProfile.email || '';
    $('edit-avatar-prev').innerHTML = `<img src="${myProfile.avatar}">`;
    show('account-modal');
};
$('home-my-avatar').onclick = $('menu-account').onclick;

$('close-account-btn').onclick = () => hide('account-modal');

$('edit-avatar-prev').onclick = () => $('edit-avatar-file').click();
let tempEditAvatar = null;
$('edit-avatar-file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    readFile(f, d => { tempEditAvatar = d; $('edit-avatar-prev').innerHTML = `<img src="${d}">`; });
};
$('update-account-btn').onclick = () => {
    const name = $('edit-name').value.trim();
    const id = $('edit-username').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
    const phone = $('edit-phone').value.trim();
    const email = $('edit-email').value.trim();
    
    if (!name || !id) return;
    
    myProfile.name = name;
    myProfile.phone = phone;
    myProfile.email = email;
    if (tempEditAvatar) myProfile.avatar = tempEditAvatar;
    
    const oldId = myProfile.customId;
    myProfile.customId = id;
    
    localStorage.setItem('gc_profile', JSON.stringify(myProfile));
    applyProfileUI();
    hide('account-modal');
    
    // Broadcast profile update to current peers
    Object.values(connections).forEach(c => {
        if (c.open) c.send({ type:'profile-sync', profile:myProfile });
    });
    
    if (idChanged) {
        sysMsg('Username changed. Reconnecting...');
        startPeer(); // Re-initialize peer with new ID
    }
};

function pingContacts() {
    Object.keys(contacts).forEach(peerId => {
        if (!connections[peerId]?.open && peerId !== 'GROUP_HOST' && !peerId.startsWith('grp_')) {
            const conn = peer.connect(peerId, { reliable:true });
            if (conn) setupConn(conn);
        }
    });
}

// ─── Peer Network ───
function startPeer() {
    if (peer) {
        peer.destroy();
    }
    peer = new Peer(myProfile.customId, { debug: 1 });
    peer.on('open', () => {
        console.log('Peer ready:', myProfile.customId);
        pingContacts();
    });
    peer.on('error', err => {
        if (err.type === 'unavailable-id') {
            if (myProfile.isGroup) {
                sysMsg('Group ID taken, please try another name.');
                myProfile.isGroup = false;
                localStorage.setItem('gc_profile', JSON.stringify(myProfile));
                startPeer();
            } else {
                show('profile-modal');
                showErr('setup-err',`"${myProfile.customId}" is taken. Choose another.`);
            }
        }
    });
    peer.on('connection', conn => { 
        setupConn(conn); 
    });
    peer.on('call', handleIncomingCall);
}

function setupConn(conn) {
    conn.on('open', () => {
        connections[conn.peer] = conn;
        conn.send({ type:'profile-sync', profile:myProfile });
        sysMsg(`${conn.peer} connected`);
        if (isHost && Object.keys(connections).length > 1) {
            broadcast({ type:'system', content:`${conn.peer} joined` }, conn.peer);
        }
    });
    conn.on('data', d => handleData(d, conn.peer));
    conn.on('close', () => {
        delete connections[conn.peer];
        const peerProfile = peerProfiles[conn.peer];
        
        if (currentPeerId === conn.peer) {
            safeSet('chat-peer-status', el => { el.textContent='Offline'; el.className='peer-sub-text offline'; });
            safeSet('chat-online-dot', el => el.classList.add('hidden'));
        }
        sysMsg(`${peerProfile?.name || conn.peer} disconnected`);
        updateContactStatus(conn.peer, false);
        renderChatList();
        
        // --- HOST MIGRATION LOGIC ---
        if (peerProfile?.isGroup) {
            sysMsg(`Group Host disconnected! Initiating Host Migration...`);
            // Determine new host
            const members = peerProfile.groupMembers || [];
            // Remove the dead host from the pool
            const activePool = members.filter(m => m !== conn.peer);
            activePool.push(myProfile.customId); // Ensure we are in the pool
            
            // Sort deterministically to find next host
            activePool.sort();
            const newHostId = activePool[0];
            
            if (newHostId === myProfile.customId) {
                // I am the new Host!
                sysMsg(`You are the new Group Host!`);
                myProfile.isGroup = true;
                myProfile.groupName = peerProfile.groupName || 'Recovered Group';
                myProfile.groupMembers = activePool;
                
                // Keep my current ID but start accepting everyone
                // Wait, if I am the new host, my ID is already my customId. 
                // Others will connect to me.
                broadcast({ type: 'profile-sync', profile: myProfile });
            } else {
                // Someone else is the host, connect to them
                sysMsg(`Connecting to new Host: ${newHostId}`);
                setTimeout(() => {
                    if (!connections[newHostId]?.open) {
                        const newConn = peer.connect(newHostId, { reliable:true });
                        setupConn(newConn);
                    }
                }, 2000);
            }
        } else if (myProfile.isGroup) {
            // We are the host and a member left. Sync updated member list.
            myProfile.groupMembers = Object.keys(connections).filter(k => connections[k].open);
            myProfile.groupMembers.push(myProfile.customId);
            broadcast({ type: 'profile-sync', profile: myProfile });
        }
    });
    conn.on('error', err => {
        console.warn('Connection error:', err);
        sysMsg('Connection failed. Try again.');
    });
}

// ─── Create Group ───
$('new-group-fab').onclick = () => show('newgroup-modal');
$('close-newgroup-modal').onclick = () => hide('newgroup-modal');
$('create-group-btn').onclick = () => {
    const name = $('newgroup-name-input').value.trim();
    if (!name) return;
    hide('newgroup-modal');
    $('newgroup-name-input').value = '';
    
    // Convert current session to a Group Host session
    const groupId = 'grp_' + name.toLowerCase().replace(/[^a-z0-9_]/g,'') + '_' + uid().substring(0,4);
    
    myProfile.isGroup = true;
    myProfile.groupName = name;
    myProfile.customId = groupId;
    myProfile.groupMembers = [groupId];
    localStorage.setItem('gc_profile', JSON.stringify(myProfile));
    
    sysMsg(`Group created! Your Group ID is: ${groupId}`);
    startPeer();
};

// ─── New Chat / Join ───
$('new-chat-fab').onclick = () => show('newchat-modal');
$('close-newchat-modal').onclick = () => hide('newchat-modal');
$('newchat-connect-btn').onclick = () => {
    const id = $('newchat-peer-input').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
    if (!id || id === myProfile.customId) { showErr('newchat-err','Invalid username.'); return; }
    hide('newchat-modal');
    $('newchat-peer-input').value = '';
    // If already connected, just open chat
    if (connections[id]?.open) {
        openChat(id);
        return;
    }
    isHost = false;
    // Show chat immediately with 'Connecting...' status
    openChat(id);
    const conn = peer.connect(id, { reliable:true });
    setupConn(conn);
};

// ─── Data Handler ───
function handleData(data, from) {
    if (data.type === 'profile-sync') {
        peerProfiles[from] = data.profile;
        if (!myProfile.isGroup) connections[from]?.send({ type:'profile-sync', profile:myProfile });
        
        // If we are a group host, a new member joined. Broadcast updated member list.
        if (myProfile.isGroup) {
            myProfile.groupMembers = Object.keys(connections).filter(k => connections[k].open);
            myProfile.groupMembers.push(myProfile.customId);
            broadcast({ type: 'profile-sync', profile: myProfile });
        }

        // Update contact
        const dName = data.profile.isGroup ? `[Group] ${data.profile.groupName}` : data.profile.name;
        
        updateContact(from, {
            name: dName, avatar: data.profile.avatar,
            status: data.profile.status, online: true
        });
        if (currentPeerId === from) updateChatHeader(from);
        updatePeerStatus(from, data.profile.isGroup ? `${data.profile.groupMembers?.length||1} members` : data.profile.status);
        renderChatList();
        
        // Also send our stories to them
        if (myStories.length > 0) {
            connections[from]?.send({ type:'story-sync', stories: myStories });
        }
        return;
    }
    if (data.type === 'story-sync') {
        peerStories[from] = data.stories.filter(s => Date.now() - s.time < 86400000);
        savePeerStories();
        renderPeerStories();
        return;
    }
    if (data.type === 'read-receipt') {
        const el = $(`tick-${data.msgId}`); if (el) el.classList.add('read');
        return;
    }
    if (data.type === 'typing') {
        if (currentPeerId === from) showTyping();
        return;
    }
    if (data.type === 'live-typing') {
        if (!settings.imoTyping || currentPeerId !== from) return;
        const el = $('live-typing-display');
        if (!data.content) { el.classList.add('hidden'); return; }
        el.textContent = `${peerProfiles[from]?.name||from}: ${data.content}`;
        el.classList.remove('hidden');
        return;
    }
    if (data.type === 'delete-msg') {
        const el = $(`msg-${data.msgId}`);
        if (el) { el.innerHTML = '<em style="opacity:.4">🚫 Deleted</em>'; }
        deleteFromHistory(from, data.msgId);
        return;
    }
    if (data.type === 'reaction') {
        const b = $(`react-${data.msgId}`);
        if (b) { b.textContent = data.emoji; b.classList.remove('hidden'); }
        return;
    }
    if (data.type === 'system') { sysMsg(data.content); return; }

    // Message
    // If the message came from a Group Host, they might be forwarding it. Use originalSender if available.
    const actualSenderId = data.originalSender || from;
    const senderName = peerProfiles[actualSenderId]?.name || actualSenderId;
    
    renderMsg(data, 'received', senderName, from);
    $('sound-msg-in').currentTime=0; $('sound-msg-in').play().catch(()=>{});
    if (document.hidden) document.title = '🔔 New Message – GhostChat';
    if (data.msgId) connections[from]?.send({ type:'read-receipt', msgId:data.msgId });
    
    // Group Routing: If I am the Host, forward this to everyone else
    if (myProfile.isGroup && data.type !== 'system') {
        data.originalSender = actualSenderId; // Keep original sender
        broadcast(data, from); // Exclude the person who sent it to us
    }

    // Update contact
    const preview = data.type==='text' ? data.content : `[${data.type}]`;
    updateContact(from, { lastMsg:preview, lastTime:Date.now() });
    incrementUnread(from);
    renderChatList();
    saveToHistory(from, data, 'received', senderName);
}

function broadcast(data, exclude=null) {
    Object.values(connections).forEach(c => { if (c.peer !== exclude && c.open) c.send(data); });
}

// ─── Chat Screen ───
function openChat(peerId) {
    currentPeerId = peerId;
    clearUnread(peerId);
    renderChatList();

    // Load history for this peer
    loadPeerHistory(peerId);

    // Update header
    updateChatHeader(peerId);

    // Slide to chat screen (mobile pushes home left, chat slides in)
    $('home-screen').classList.add('pushed');
    $('chat-screen').classList.add('active');
    // Scroll to bottom after render
    setTimeout(() => {
        const mc = $('messages-container');
        if (mc) mc.scrollTop = mc.scrollHeight;
    }, 100);
}

$('chat-back-btn').onclick = () => {
    $('home-screen').classList.remove('pushed');
    $('chat-screen').classList.remove('active');
    currentPeerId = null;
    // Clear search
    $('chat-search-bar').classList.add('hidden');
};

function updateChatHeader(peerId) {
    const p = peerProfiles[peerId] || contacts[peerId] || {};
    safeSet('chat-peer-name', el => el.textContent = p.name || peerId);
    safeSet('chat-peer-avatar', el => el.src = p.avatar || defaultAvatar());
    const online = !!connections[peerId]?.open;
    safeSet('chat-peer-status', el => {
        el.textContent = online ? (p.status||'Online') : 'Offline';
        el.className = `peer-sub-text ${online?'':'offline'}`;
    });
    const dot = $('chat-online-dot');
    if (dot) dot.classList.toggle('hidden', !online);
}

// ─── Contacts ───
async function loadContacts() {
    contacts = await localforage.getItem('gc_contacts') || {};
}
async function saveContacts() {
    await localforage.setItem('gc_contacts', contacts);
}
function updateContact(peerId, fields) {
    if (!contacts[peerId]) contacts[peerId] = { name:peerId, avatar:defaultAvatar(), unread:0 };
    Object.assign(contacts[peerId], fields);
    saveContacts();
}
function updateContactStatus(peerId, online) {
    if (contacts[peerId]) { contacts[peerId].online = online; saveContacts(); }
}
function incrementUnread(peerId) {
    if (currentPeerId === peerId) return; // already viewing
    if (!contacts[peerId]) contacts[peerId] = { unread:0 };
    contacts[peerId].unread = (contacts[peerId].unread || 0) + 1;
    saveContacts();
}
function clearUnread(peerId) {
    if (contacts[peerId]) { contacts[peerId].unread = 0; saveContacts(); }
}

function renderChatList() {
    const list = $('chat-list');
    const items = Object.entries(contacts).sort((a,b) => (b[1].lastTime||0)-(a[1].lastTime||0));
    if (!items.length && !myProfile.isGroup) {
        list.innerHTML = `<li class="empty-state"><i class="fa-solid fa-ghost"></i><p>No conversations yet</p><small>Tap the ✉️ button below to start</small></li>`;
        return;
    }
    list.innerHTML = '';

    // Group Host Chat Item
    if (myProfile.isGroup) {
        const memCount = myProfile.groupMembers?.length || 1;
        const groupLi = document.createElement('li');
        groupLi.className = 'chat-list-item';
        groupLi.style.background = 'rgba(16, 185, 129, 0.1)'; // faint green highlight
        groupLi.innerHTML = `
            <div class="chat-item-avatar">
                <div style="width:50px;height:50px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;color:white;font-size:1.5rem;"><i class="fa-solid fa-users"></i></div>
            </div>
            <div class="chat-item-body">
                <div class="chat-item-top">
                    <span class="chat-item-name" style="color:var(--primary)">${myProfile.groupName} (Host)</span>
                </div>
                <div class="chat-item-bottom">
                    <span class="chat-item-last" style="color:var(--primary)">Tap to open lobby · ${memCount} members</span>
                </div>
            </div>
        `;
        let groupPressT, isGroupLongPress = false;
        groupLi.addEventListener('pointerdown', e => {
            isGroupLongPress = false;
            groupPressT = setTimeout(() => {
                isGroupLongPress = true;
                showGroupContextMenu(e);
            }, 500);
        });
        groupLi.addEventListener('pointerup', ()=>clearTimeout(groupPressT));
        groupLi.addEventListener('pointerleave', ()=>clearTimeout(groupPressT));
        
        groupLi.onclick = (e) => {
            if (isGroupLongPress) { e.preventDefault(); return; }
            openGroupHostChat();
        };
        list.appendChild(groupLi);
    }

    items.forEach(([peerId, c]) => {
        const online = !!connections[peerId]?.open;
        const time = c.lastTime ? timeAgo(c.lastTime) : '';
        const li = document.createElement('li');
        li.className = 'chat-list-item';
        li.innerHTML = `
            <div class="chat-item-avatar">
                <img src="${c.avatar||defaultAvatar()}" alt="">
                <div class="${online?'online-badge':'offline-badge'}"></div>
            </div>
            <div class="chat-item-body">
                <div class="chat-item-top">
                    <span class="chat-item-name">${c.name||peerId}</span>
                    <span class="chat-item-time">${time}</span>
                </div>
                <div class="chat-item-bottom">
                    <span class="chat-item-last">${c.lastMsg||'Tap to connect'}</span>
                    ${c.unread>0?`<span class="unread-badge">${c.unread}</span>`:''}
                </div>
            </div>`;
        
        let pressT, isLongPress = false;
        li.addEventListener('pointerdown', e => { 
            isLongPress = false;
            pressT = setTimeout(()=>{ 
                isLongPress = true;
                showChatContextMenu(e,peerId); 
            }, 500); 
        });
        li.addEventListener('pointerup', ()=>clearTimeout(pressT));
        li.addEventListener('pointerleave', ()=>clearTimeout(pressT));
        
        li.onclick = (e) => {
            if (isLongPress) { e.preventDefault(); return; }
            // Always open the chat screen first
            openChat(peerId);
            // If not connected, try to connect in background
            if (!connections[peerId]?.open) {
                const conn = peer.connect(peerId, { reliable:true });
                isHost = false;
                setupConn(conn);
            }
        };
        list.appendChild(li);
    });
}

function openGroupHostChat() {
    currentPeerId = 'GROUP_HOST';
    renderChatList();
    loadPeerHistory('GROUP_HOST');
    safeSet('chat-peer-name', el => el.textContent = myProfile.groupName + ' (Lobby)');
    safeSet('chat-peer-avatar', el => el.src = defaultAvatar());
    safeSet('chat-peer-status', el => {
        el.textContent = `${myProfile.groupMembers?.length || 1} members active`;
        el.className = 'peer-sub-text';
    });
    const dot = $('chat-online-dot');
    if(dot) dot.classList.remove('hidden');

    $('home-screen').classList.add('pushed');
    $('chat-screen').classList.add('active');
    setTimeout(() => {
        const mc = $('messages-container');
        if (mc) mc.scrollTop = mc.scrollHeight;
    }, 100);
}

function showChatContextMenu(e, peerId) {
    e.preventDefault();
    e.stopPropagation();
    const pop=$('reaction-popup');
    pop.innerHTML='';
    const d=document.createElement('span'); d.className='r-action del'; d.innerHTML='<i class="fa-solid fa-trash"></i> Delete Chat History';
    d.onclick=async()=>{ 
        if(confirm('Delete chat history for this contact?')) {
            await localforage.removeItem(`hist_${peerId}`);
            delete contacts[peerId];
            saveContacts();
            renderChatList();
        }
        pop.classList.add('hidden'); 
    }; 
    pop.appendChild(d);
    const x=Math.min(e.clientX,window.innerWidth-200), y=Math.max(e.clientY-30,10);
    pop.style.left=x+'px'; pop.style.top=y+'px'; pop.classList.remove('hidden');
}

function showGroupContextMenu(e) {
    e.preventDefault(); e.stopPropagation();
    const pop = $('reaction-popup');
    pop.innerHTML = '';
    
    const c1 = document.createElement('span'); c1.className='r-action'; c1.innerHTML='<i class="fa-solid fa-copy"></i> Copy Group Code';
    c1.onclick = () => { navigator.clipboard.writeText(myProfile.customId); pop.classList.add('hidden'); alert('Copied Group Code:\n' + myProfile.customId); };
    pop.appendChild(c1);

    const c2 = document.createElement('span'); c2.className='r-action'; c2.innerHTML='<i class="fa-solid fa-share-nodes"></i> Share Invite Link';
    c2.onclick = () => { 
        const link = window.location.origin + window.location.pathname + '?join=' + myProfile.customId;
        if (navigator.share) { navigator.share({ title: 'Join my GhostChat Group', url: link }); }
        else { navigator.clipboard.writeText(link); alert('Invite Link copied!'); }
        pop.classList.add('hidden'); 
    };
    pop.appendChild(c2);

    const d = document.createElement('span'); d.className='r-action del'; d.innerHTML='<i class="fa-solid fa-trash"></i> Disband Group';
    d.onclick = () => {
        if (confirm('Are you sure you want to disband this group?')) {
            myProfile.isGroup = false;
            myProfile.groupName = '';
            myProfile.groupMembers = [];
            localStorage.setItem('gc_profile', JSON.stringify(myProfile));
            startPeer();
            renderChatList();
        }
        pop.classList.add('hidden');
    };
    pop.appendChild(d);

    const x = Math.min(e.clientX, window.innerWidth - 200), y = Math.max(e.clientY - 30, 10);
    pop.style.left=x+'px'; pop.style.top=y+'px'; pop.classList.remove('hidden');
}

// ─── Status & Stories Feature ───
async function loadStories() {
    myStories = await localforage.getItem('gc_my_stories') || [];
    peerStories = await localforage.getItem('gc_peer_stories') || {};
    // Clean up old stories (> 24h)
    const now = Date.now();
    myStories = myStories.filter(s => now - s.time < 86400000);
    Object.keys(peerStories).forEach(p => {
        peerStories[p] = peerStories[p].filter(s => now - s.time < 86400000);
        if (peerStories[p].length === 0) delete peerStories[p];
    });
    localforage.setItem('gc_my_stories', myStories);
    savePeerStories();
}
function savePeerStories() { localforage.setItem('gc_peer_stories', peerStories); }

$('edit-my-status-btn').onclick = () => {
    $('status-input-area').classList.toggle('hidden');
    $('status-text-input').value = myProfile.status;
};
$('status-photo-btn').onclick = () => { $('status-media-input').accept = 'image/*'; $('status-media-input').click(); };
$('status-video-btn').onclick = () => { $('status-media-input').accept = 'video/*'; $('status-media-input').click(); };

$('status-media-input').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { showErr('setup-err', 'File too large (Max 5MB)'); return; }
    readFile(f, b64 => {
        addStory(f.type.startsWith('video') ? 'video' : 'image', b64);
    });
};

$('btn-update-status').onclick = () => {
    $('status-edit-box').classList.toggle('hidden');
    $('status-input-settings').value = myProfile.status;
};
$('save-status-btn').onclick = saveStatus;
$('post-status-btn').onclick = saveStatus;

function saveStatus() {
    const txt = ($('status-text-input').value || $('status-input-settings').value).trim();
    if (txt) {
        myProfile.status = txt;
        localStorage.setItem('gc_profile', JSON.stringify(myProfile));
        safeSet('my-status-text-display', el => el.textContent = txt);
        addStory('text', txt);
    }
    $('status-input-area').classList.add('hidden');
    $('status-edit-box').classList.add('hidden');
}

function addStory(type, content) {
    myStories.push({ id: Date.now().toString(), type, content, time: Date.now() });
    localforage.setItem('gc_my_stories', myStories);
    broadcast({ type:'story-sync', stories: myStories });
    renderPeerStories(); // Render my own story preview (optional)
}

function renderPeerStories() {
    const list = $('peer-status-list');
    list.innerHTML = '';
    // Show my stories if any
    if (myStories.length > 0) {
        list.appendChild(createStoryElement('My Status', myProfile.avatar, myStories));
    }
    // Show peers' stories
    Object.keys(peerStories).forEach(peerId => {
        const stories = peerStories[peerId];
        const p = peerProfiles[peerId] || contacts[peerId] || { name: peerId, avatar: defaultAvatar() };
        if (stories.length > 0) {
            list.appendChild(createStoryElement(p.name||peerId, p.avatar, stories));
        }
    });
    if (list.innerHTML === '') {
        list.innerHTML = `<li class="empty-state"><i class="fa-solid fa-circle-dot"></i><p>No status updates yet</p></li>`;
    }
}

function createStoryElement(name, avatar, stories) {
    const li = document.createElement('li');
    li.className = 'status-list-item';
    li.style.cursor = 'pointer';
    const lastTime = timeAgo(stories[stories.length-1].time);
    
    // Draw ring
    const ringColor = 'var(--primary)'; // Unread status could make it green, read could be gray
    
    li.innerHTML = `
        <div style="position:relative;">
            <img src="${avatar||defaultAvatar()}" alt="" style="border: 2px solid ${ringColor}; padding:2px;">
        </div>
        <div class="status-item-text">
            <strong>${name}</strong>
            <p>${stories.length} updates</p>
            <small>${lastTime}</small>
        </div>`;
    
    li.onclick = () => openStatusViewer(name, avatar, stories);
    return li;
}

// ─── Status Viewer Logic ───
let svIndex = 0;
let svStories = [];
let svTimer = null;
let svIsPaused = false;

function openStatusViewer(name, avatar, stories) {
    svStories = stories;
    svIndex = 0;
    svIsPaused = false;
    $('sv-name').textContent = name;
    $('sv-avatar').src = avatar || defaultAvatar();
    $('status-viewer-screen').classList.remove('hidden');
    renderSvProgressBars();
    playStatus();
}

function renderSvProgressBars() {
    const c = $('status-progress-container');
    c.innerHTML = '';
    svStories.forEach((_, i) => {
        const bar = document.createElement('div');
        bar.className = 'status-progress-bar';
        const fill = document.createElement('div');
        fill.className = 'status-progress-fill';
        fill.id = `sv-fill-${i}`;
        if (i < svIndex) fill.style.width = '100%';
        bar.appendChild(fill);
        c.appendChild(bar);
    });
}

function playStatus() {
    if (svIndex >= svStories.length) {
        closeStatusViewer();
        return;
    }
    const s = svStories[svIndex];
    $('sv-time').textContent = timeAgo(s.time);
    const ca = $('sv-content-area');
    const ta = $('sv-text-area');
    ca.innerHTML = ''; ta.textContent = '';
    
    let duration = 5000;
    if (s.type === 'text') {
        ca.innerHTML = `<div style="padding:40px; text-align:center; color:white; font-size:2rem; font-weight:bold;">${s.content}</div>`;
        startSvTimer(duration);
    } else if (s.type === 'image') {
        ca.innerHTML = `<img src="${s.content}" style="width:100%; height:100%; object-fit:contain;">`;
        startSvTimer(duration);
    } else if (s.type === 'video') {
        const v = document.createElement('video');
        v.src = s.content; v.style.width = '100%'; v.style.height = '100%'; v.style.objectFit = 'contain';
        v.autoplay = true; v.playsInline = true;
        v.onloadedmetadata = () => startSvTimer(v.duration * 1000);
        v.onended = () => nextStatus();
        ca.appendChild(v);
    }
}

function startSvTimer(ms) {
    clearInterval(svTimer);
    const fill = $(`sv-fill-${svIndex}`);
    if (!fill) return;
    let start = Date.now();
    svTimer = setInterval(() => {
        if (svIsPaused) { start += 50; return; }
        let p = ((Date.now() - start) / ms) * 100;
        if (p >= 100) { p = 100; clearInterval(svTimer); nextStatus(); }
        fill.style.width = p + '%';
    }, 50);
}

function nextStatus() {
    const fill = $(`sv-fill-${svIndex}`);
    if (fill) fill.style.width = '100%';
    svIndex++;
    renderSvProgressBars(); // Ensure past bars are full
    playStatus();
}

function prevStatus() {
    const fill = $(`sv-fill-${svIndex}`);
    if (fill) fill.style.width = '0%';
    svIndex--;
    if (svIndex < 0) svIndex = 0;
    renderSvProgressBars();
    playStatus();
}

function closeStatusViewer() {
    clearInterval(svTimer);
    $('status-viewer-screen').classList.add('hidden');
    const ca = $('sv-content-area');
    ca.innerHTML = ''; // Stop video playback
}
$('close-status-viewer').onclick = closeStatusViewer;
$('sv-tap-left').onclick = prevStatus;
$('sv-tap-right').onclick = nextStatus;

// Pause on hold
$('sv-tap-left').onmousedown = () => svIsPaused = true;
$('sv-tap-left').onmouseup = () => svIsPaused = false;
$('sv-tap-left').ontouchstart = () => svIsPaused = true;
$('sv-tap-left').ontouchend = () => svIsPaused = false;
$('sv-tap-right').onmousedown = () => svIsPaused = true;
$('sv-tap-right').onmouseup = () => svIsPaused = false;
$('sv-tap-right').ontouchstart = () => svIsPaused = true;
$('sv-tap-right').ontouchend = () => svIsPaused = false;


// ─── Tabs ───
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
        btn.classList.add('active');
        $('tab-'+btn.dataset.tab).classList.add('active');
        
        // Auto-request statuses when opening status tab
        if (btn.dataset.tab === 'status' && !myProfile.isGroup) {
            broadcast({ type:'profile-sync', profile:myProfile });
        }
    };
});

// ─── Home Search ───
$('home-search-btn').onclick = () => $('home-search-bar').classList.toggle('hidden');
$('close-home-search').onclick = () => { $('home-search-bar').classList.add('hidden'); $('home-search-input').value=''; renderChatList(); };
$('home-search-input').oninput = () => {
    const q = $('home-search-input').value.toLowerCase();
    document.querySelectorAll('.chat-list-item').forEach(li => {
        li.style.display = li.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
};

// ─── Settings ───
$('close-settings-btn').onclick = () => {
    settings.imoTyping    = $('s-imo-typing').checked;
    settings.selfDestruct = $('s-self-destruct').checked;
    localStorage.setItem('gc_settings', JSON.stringify(settings));
    const ts = $('s-text-size').value;
    document.body.setAttribute('data-text-size', ts);
    localStorage.setItem('gc_textsize', ts);
    hide('settings-modal');
};
async function loadSettings() {
    const s = localStorage.getItem('gc_settings');
    if (s) {
        settings = JSON.parse(s);
        $('s-imo-typing').checked    = settings.imoTyping;
        $('s-self-destruct').checked = settings.selfDestruct;
    }
    const ts = localStorage.getItem('gc_textsize');
    if (ts) { $('s-text-size').value = ts; document.body.setAttribute('data-text-size', ts); }
    const bg = localStorage.getItem('gc_wallpaper');
    if (bg) applyWallpaper(bg);
}

$('btn-wallpaper').onclick = () => $('wallpaper-file').click();
$('wallpaper-file').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    readFile(f, d => { applyWallpaper(d); localStorage.setItem('gc_wallpaper',d); });
};
function applyWallpaper(url) {
    $('messages-container').style.backgroundImage = `url(${url})`;
    $('messages-container').style.backgroundSize  = 'cover';
}

// ─── In-chat Search ───
$('chat-search-btn').onclick = () => $('chat-search-bar').classList.toggle('hidden');
$('close-chat-search').onclick = () => { $('chat-search-bar').classList.add('hidden'); clearMsgHighlights(); };
$('chat-search-input').oninput = () => {
    const q = $('chat-search-input').value.toLowerCase().trim();
    clearMsgHighlights();
    if (!q) return;
    document.querySelectorAll('#messages-container .message').forEach(m => {
        if (m.textContent.toLowerCase().includes(q)) m.style.outline = '2px solid var(--primary)';
    });
};
function clearMsgHighlights() {
    document.querySelectorAll('#messages-container .message').forEach(m => m.style.outline='');
}

// ─── Send Message ───
const msgInput = $('message-input');
msgInput.oninput = () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight,110)+'px';
    const has = msgInput.value.trim().length>0;
    $('send-btn').classList.toggle('hidden',!has);
    $('voice-btn').classList.toggle('hidden',has);
    broadcast({ type:'typing' });
    if (settings.imoTyping) broadcast({ type:'live-typing', content:msgInput.value });
};
msgInput.addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); sendMsg(); } });
$('send-btn').onclick = sendMsg;

function sendMsg() {
    const text = msgInput.value.trim();
    if (!text || Object.keys(connections).length===0) return;
    const msgId = uid();
    const payload = { type:'text', content:text, msgId, replyTo:replyMsgId, selfDestruct:settings.selfDestruct, timestamp:Date.now() };
    if (currentPeerId === 'GROUP_HOST') {
        payload.originalSender = myProfile.customId;
        broadcast(payload);
        renderMsg(payload,'sent','Me', currentPeerId);
        if (settings.imoTyping) broadcast({ type:'live-typing', content:'' });
        saveToHistory('GROUP_HOST', payload, 'sent', 'Me');
    } else {
        broadcast(payload);
        renderMsg(payload,'sent','Me', currentPeerId);
        if (settings.imoTyping) broadcast({ type:'live-typing', content:'' });
        const preview = text.length>40?text.substr(0,40)+'…':text;
        updateContact(currentPeerId, { lastMsg:preview, lastTime:Date.now() });
        if (currentPeerId) saveToHistory(currentPeerId, payload, 'sent', 'Me');
    }
    
    $('sound-msg-out').currentTime=0; $('sound-msg-out').play().catch(()=>{});
    msgInput.value=''; msgInput.style.height='auto';
    $('send-btn').classList.add('hidden'); $('voice-btn').classList.remove('hidden');
    closeReply();
    renderChatList();
}

function buildAudioPlayer(src) {
    const wrap = document.createElement('div');
    wrap.className = 'custom-audio-player';
    wrap.innerHTML = `
        <button class="audio-play-btn"><i class="fa-solid fa-play"></i></button>
        <div class="audio-track">
            <div class="audio-progress"></div>
        </div>
        <span class="audio-time">0:00</span>
        <audio src="${src}" hidden></audio>
    `;
    const audio = wrap.querySelector('audio');
    const btn = wrap.querySelector('button');
    const track = wrap.querySelector('.audio-track');
    const prog = wrap.querySelector('.audio-progress');
    const timeDisplay = wrap.querySelector('.audio-time');

    btn.onclick = () => {
        if (audio.paused) {
            document.querySelectorAll('.custom-audio-player audio').forEach(a => {
                a.pause();
                a.parentElement.querySelector('.audio-play-btn').innerHTML = '<i class="fa-solid fa-play"></i>';
            });
            audio.play().catch(()=>{});
            btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        } else {
            audio.pause();
            btn.innerHTML = '<i class="fa-solid fa-play"></i>';
        }
    };
    audio.ontimeupdate = () => {
        const p = (audio.currentTime / (audio.duration || 1)) * 100;
        prog.style.width = p + '%';
        const m = Math.floor(audio.currentTime / 60);
        const s = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
        timeDisplay.textContent = `${m}:${s}`;
    };
    audio.onended = () => {
        btn.innerHTML = '<i class="fa-solid fa-play"></i>';
        prog.style.width = '0%';
        timeDisplay.textContent = '0:00';
    };
    audio.onloadedmetadata = () => {
        const d = audio.duration;
        if (d && d !== Infinity) {
            const m = Math.floor(d / 60);
            const s = Math.floor(d % 60).toString().padStart(2, '0');
            timeDisplay.textContent = `${m}:${s}`;
        }
    };
    track.onclick = (e) => {
        const rect = track.getBoundingClientRect();
        const p = (e.clientX - rect.left) / rect.width;
        audio.currentTime = p * (audio.duration || 0);
    };
    return wrap;
}

// ─── Render Message ───
function renderMsg(data, align, senderName, peerId) {
    if (data.type==='system') { sysMsg(data.content); return; }
    const wrap = $('messages-container');
    const div = document.createElement('div');
    div.className=`message ${align}`; div.id=`msg-${data.msgId}`;

    if (align==='received') {
        const nm=document.createElement('div'); nm.className='sender-name'; nm.textContent=senderName; div.appendChild(nm);
    }
    if (data.replyTo) {
        const rb=document.createElement('div'); rb.className='reply-preview-msg';
        rb.innerHTML='<strong>↩ Replied</strong>';
        rb.onclick=()=>$(`msg-${data.replyTo}`)?.scrollIntoView({behavior:'smooth',block:'center'});
        div.appendChild(rb);
    }
    const body=document.createElement('div'); body.className='msg-text';
    if (data.type==='text')  body.textContent=data.content;
    else if (data.type==='image') { const i=document.createElement('img'); i.src=data.content; body.appendChild(i); }
    else if (data.type==='video') { const v=document.createElement('video'); v.src=data.content; v.controls=true; body.appendChild(v); }
    else if (data.type==='audio') { body.appendChild(buildAudioPlayer(data.content)); }
    div.appendChild(body);

    const meta=document.createElement('div'); meta.className='msg-meta';
    if (data.selfDestruct) { const s=document.createElement('span'); s.textContent='💣'; meta.appendChild(s); }
    const t=document.createElement('span');
    t.textContent=fmtTime(data.timestamp||Date.now()); meta.appendChild(t);
    if (align==='sent') {
        const tick=document.createElement('span'); tick.className='tick'; tick.id=`tick-${data.msgId}`; tick.textContent='✓✓'; meta.appendChild(tick);
    }
    div.appendChild(meta);

    const rb2=document.createElement('div'); rb2.className='react-badge hidden'; rb2.id=`react-${data.msgId}`; div.appendChild(rb2);

    let pressT;
    div.addEventListener('pointerdown', e=>{ pressT=setTimeout(()=>showCtxMenu(e,data.msgId,align),500); });
    div.addEventListener('pointerup', ()=>clearTimeout(pressT));
    div.addEventListener('pointerleave',()=>clearTimeout(pressT));

    wrap.appendChild(div);
    wrap.scrollTop=wrap.scrollHeight;

    if (data.selfDestruct && align==='received') {
        setTimeout(()=>{ div.innerHTML='<em style="opacity:.4">🚫 Self-destructed</em>'; deleteFromHistory(peerId,data.msgId); },10000);
    }
}

function sysMsg(txt) {
    const d=document.createElement('div'); d.className='message system'; d.textContent=txt;
    $('messages-container').appendChild(d);
    $('messages-container').scrollTop=$('messages-container').scrollHeight;
}

// ─── Typing Indicator ───
let typT;
function showTyping() {
    $('typing-bubble').classList.remove('hidden');
    $('messages-container').scrollTop=$('messages-container').scrollHeight;
    clearTimeout(typT);
    typT=setTimeout(()=>$('typing-bubble').classList.add('hidden'),2500);
}

// ─── Context Menu ───
let ctxId=null, ctxAlign=null;
function showCtxMenu(e,msgId,align) {
    ctxId=msgId; ctxAlign=align;
    const pop=$('reaction-popup');
    pop.innerHTML='';
    ['👍','❤️','😂','😮','😢'].forEach(em=>{
        const s=document.createElement('span'); s.className='r-emoji'; s.textContent=em;
        s.onclick=()=>sendReaction(em); pop.appendChild(s);
    });
    const dv=document.createElement('div'); dv.className='r-div'; pop.appendChild(dv);
    const ra=document.createElement('span'); ra.className='r-action'; ra.textContent='↩ Reply';
    ra.onclick=()=>{ setReply(msgId); pop.classList.add('hidden'); }; pop.appendChild(ra);
    
    const dm=document.createElement('span'); dm.className='r-action del'; dm.textContent='🗑 Delete for Me';
    dm.onclick=()=>{ deleteMsgForMe(msgId); pop.classList.add('hidden'); }; pop.appendChild(dm);

    if (align==='sent') {
        const da=document.createElement('span'); da.className='r-action del'; da.textContent='🗑 Delete for Everyone';
        da.onclick=()=>{ deleteMsgForAll(msgId); pop.classList.add('hidden'); }; pop.appendChild(da);
    }
    const x=Math.min(e.clientX,window.innerWidth-260), y=Math.max(e.clientY-55,10);
    pop.style.left=x+'px'; pop.style.top=y+'px'; pop.classList.remove('hidden');
}
document.onclick=e=>{ if (!e.target.closest('.reaction-popup')&&!e.target.closest('.message')) $('reaction-popup').classList.add('hidden'); };

function sendReaction(emoji) {
    if (!ctxId) return;
    const p={type:'reaction',emoji,msgId:ctxId};
    broadcast(p);
    const b=$(`react-${ctxId}`); if (b) { b.textContent=emoji; b.classList.remove('hidden'); }
    $('reaction-popup').classList.add('hidden');
}
function setReply(msgId) {
    replyMsgId=msgId;
    $('reply-preview-bar').classList.remove('hidden');
    msgInput.focus();
}
$('close-reply-btn').onclick=closeReply;
function closeReply() { replyMsgId=null; $('reply-preview-bar').classList.add('hidden'); }

function deleteMsgForMe(msgId) {
    const el=$(`msg-${msgId}`); if (el) el.innerHTML='<em style="opacity:.4">🚫 Deleted for you</em>';
    deleteFromHistory(currentPeerId,msgId);
}
function deleteMsgForAll(msgId) {
    const p={type:'delete-msg',msgId}; broadcast(p);
    const el=$(`msg-${msgId}`); if (el) el.innerHTML='<em style="opacity:.4">🚫 Deleted for everyone</em>';
    deleteFromHistory(currentPeerId,msgId);
}

// ─── File Attachment ───
$('attach-btn').onclick=()=>$('file-input').click();
$('file-input').onchange=e=>{
    const f=e.target.files[0]; if (!f||Object.keys(connections).length===0) return;
    if (f.size>50*1024*1024) { alert('Max 50MB'); return; }
    const prog=$('upload-progress'), bar=$('upload-bar');
    prog.classList.remove('hidden'); bar.style.width='0%';
    readFile(f, d=>{
        setTimeout(()=>prog.classList.add('hidden'),600);
        const type=f.type.startsWith('image/')?'image':f.type.startsWith('video/')?'video':null;
        if (!type) return;
        const msgId=uid();
        const payload={type,content:d,msgId,selfDestruct:settings.selfDestruct,timestamp:Date.now()};
        broadcast(payload); renderMsg(payload,'sent','Me',currentPeerId);
        saveToHistory(currentPeerId,payload,'sent','Me');
        updateContact(currentPeerId,{lastMsg:`[${type}]`,lastTime:Date.now()}); renderChatList();
    }, p=>{ bar.style.width=p+'%'; });
    $('file-input').value='';
};

// ─── History (IndexedDB) ───
async function saveToHistory(peerId, data, align, senderName) {
    if (!peerId||data.selfDestruct) return;
    const key=`hist_${peerId}`;
    let h=await localforage.getItem(key)||[];
    h.push({...data,align,senderName,ts:Date.now()});
    await localforage.setItem(key,h);
}
async function loadPeerHistory(peerId) {
    const key=`hist_${peerId}`;
    let h=await localforage.getItem(key)||[];
    const now=Date.now(), day=86400000;
    h=h.filter(m=>(now-m.ts)<day);
    await localforage.setItem(key,h);
    $('messages-container').innerHTML='<div class="message system">🔒 Encrypted. History auto-deletes in 24h.</div>';
    h.forEach(m=>{ m.fromHistory=true; renderMsg(m,m.align,m.senderName,peerId); });
}
async function deleteFromHistory(peerId,msgId) {
    const key=`hist_${peerId}`;
    let h=await localforage.getItem(key)||[];
    h=h.filter(m=>m.msgId!==msgId);
    await localforage.setItem(key,h);
}

$('btn-clear-history').onclick=async()=>{
    const keys=Object.keys(contacts).map(p=>`hist_${p}`);
    await Promise.all(keys.map(k=>localforage.removeItem(k)));
    $('messages-container').innerHTML='<div class="message system">History cleared.</div>';
    hide('settings-modal');
};

// ─── Backup ───
$('btn-export-backup').onclick=async()=>{
    const data={ version:'v6', profile:myProfile, contacts, settings };
    const keys=Object.keys(contacts).map(p=>`hist_${p}`);
    data.histories={};
    for (const k of keys) { const h=await localforage.getItem(k)||[]; data.histories[k]=h; }
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
    a.download=`GhostChat_backup_${Date.now()}.json`; a.click();
};
$('btn-import-backup').onclick=()=>$('backup-file').click();
$('backup-file').onchange=async e=>{
    const f=e.target.files[0]; if (!f) return;
    const txt=await f.text();
    try {
        const data=JSON.parse(txt);
        if (data.profile) { myProfile=data.profile; localStorage.setItem('gc_profile',JSON.stringify(myProfile)); applyProfileUI(); }
        if (data.contacts) { contacts=data.contacts; await saveContacts(); renderChatList(); }
        if (data.settings) { settings=data.settings; localStorage.setItem('gc_settings',JSON.stringify(settings)); }
        if (data.histories) { for (const [k,v] of Object.entries(data.histories)) await localforage.setItem(k,v); }
        alert('✅ Backup restored successfully!');
        hide('settings-modal');
    } catch(err) { alert('❌ Invalid backup file.'); }
};
$('btn-export-txt').onclick=async()=>{
    let txt='GhostChat History Export\n\n';
    for (const [peerId,c] of Object.entries(contacts)) {
        const h=await localforage.getItem(`hist_${peerId}`)||[];
        txt+=`═══ ${c.name||peerId} ═══\n`;
        h.forEach(m=>{ txt+=m.type==='text'?`[${fmtTime(m.ts)}] ${m.senderName}: ${m.content}\n`:`[${fmtTime(m.ts)}] ${m.senderName}: [${m.type}]\n`; });
        txt+='\n';
    }
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'text/plain'}));
    a.download=`GhostChat_export_${Date.now()}.txt`; a.click();
};

// ─── Call Log ───
async function loadCallLog() { callLog=await localforage.getItem('gc_calllog')||[]; }
async function saveCallLog() { await localforage.setItem('gc_calllog',callLog); }
function addCallLog(peerId, type, direction) {
    const p=peerProfiles[peerId]||contacts[peerId]||{};
    callLog.unshift({ peerId, name:p.name||peerId, avatar:p.avatar||defaultAvatar(), type, direction, ts:Date.now() });
    if (callLog.length>50) callLog=callLog.slice(0,50);
    saveCallLog(); renderCallLog();
}
function renderCallLog() {
    const list=$('call-log-list');
    if (!callLog.length) { list.innerHTML=`<li class="empty-state"><i class="fa-solid fa-phone"></i><p>No recent calls</p></li>`; return; }
    list.innerHTML='';
    callLog.forEach(c=>{
        const li=document.createElement('li'); li.className='call-log-item';
        const icon=c.direction==='in'?'fa-phone-volume':'fa-phone-arrow-up-right';
        const cls=c.direction==='missed'?'call-missed':c.direction==='in'?'call-in':'call-out';
        li.innerHTML=`<img src="${c.avatar}" alt=""><div class="call-log-body"><strong>${c.name}</strong><p class="${cls}"><i class="fa-solid ${icon}"></i> ${c.type==='video'?'Video':'Voice'} call · ${timeAgo(c.ts)}</p></div><button class="icon-btn" style="color:var(--primary)" title="Call back"><i class="fa-solid fa-phone"></i></button>`;
        li.querySelector('button').onclick=()=>makeCall(c.peerId,'audio');
        list.appendChild(li);
    });
}

// ─── Helpers ───
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function safeSet(id, fn) { const el=$(id); if(el) fn(el); }
function showErr(id, msg) { const el=$(id); if(el){ el.textContent=msg; el.classList.remove('hidden'); } }
function uid() { return Math.random().toString(36).substr(2,9); }
function fmtTime(ts) { const d=new Date(ts); return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`; }
function timeAgo(ts) {
    const diff=Date.now()-ts, m=60000, h=3600000, day=86400000;
    if (diff<m)  return 'Just now';
    if (diff<h)  return Math.floor(diff/m)+'m ago';
    if (diff<day) return Math.floor(diff/h)+'h ago';
    return new Date(ts).toLocaleDateString();
}
function defaultAvatar() {
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2310b981'%3E%3Cpath d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/%3E%3C/svg%3E";
}
function readFile(f, onLoad, onProgress=null) {
    const r=new FileReader();
    r.onload=e=>{
        const res = e.target.result;
        if (f.type.startsWith('image/')) {
            const img = new Image();
            img.onload = () => {
                const cvs = document.createElement('canvas');
                const MAX_WIDTH = 1200, MAX_HEIGHT = 1200;
                let w = img.width, h = img.height;
                if (w > MAX_WIDTH || h > MAX_HEIGHT) {
                    if (w > h) { h *= MAX_WIDTH / w; w = MAX_WIDTH; }
                    else { w *= MAX_HEIGHT / h; h = MAX_HEIGHT; }
                }
                cvs.width = w; cvs.height = h;
                const ctx = cvs.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                onLoad(cvs.toDataURL('image/jpeg', 0.6));
            };
            img.src = res;
        } else {
            onLoad(res);
        }
    };
    if (onProgress) r.onprogress=e=>{ if(e.lengthComputable) onProgress(Math.round(e.loaded/e.total*100)); };
    r.readAsDataURL(f);
}
window.onfocus=()=>{ document.title='GhostChat – Private Messenger'; };

// ─── Boot ───
boot();
