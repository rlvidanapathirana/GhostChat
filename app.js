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

// ─── DB ───
localforage.config({ name:'GhostChatV6', storeName:'store' });

// ─── DOM shortcuts ───
const $ = id => document.getElementById(id);

// ─── Boot ───
async function boot() {
    const agreed = localStorage.getItem('gc_agreed');
    if (!agreed) { show('terms-modal'); return; }
    await loadSettings();
    const saved = localStorage.getItem('gc_profile');
    if (!saved) { show('profile-modal'); return; }
    myProfile = JSON.parse(saved);
    applyProfileUI();
    await loadContacts();
    await loadCallLog();
    renderChatList();
    renderCallLog();
    startPeer();
}

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
    const id   = $('setup-username').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
    const status=$('setup-status').value.trim() || myProfile.status;
    if (!name || !id) { showErr('setup-err','Fill in all fields.'); return; }
    if (!myProfile.avatar) myProfile.avatar = defaultAvatar();
    myProfile = { ...myProfile, name, customId:id, status };
    localStorage.setItem('gc_profile', JSON.stringify(myProfile));
    hide('profile-modal');
    applyProfileUI();
    startPeer();
};

function applyProfileUI() {
    const avatarEls = ['hdr-avatar-img','my-status-avatar','chat-peer-avatar'];
    safeSet('hdr-avatar-img', el => { el.src = myProfile.avatar; });
    safeSet('my-status-avatar', el => { el.src = myProfile.avatar; });
    safeSet('my-status-text-display', el => { el.textContent = myProfile.status; });
}

// ─── Peer Network ───
function startPeer() {
    if (peer) peer.destroy();
    peer = new Peer(myProfile.customId, { debug: 0 });
    peer.on('open', () => console.log('Peer ready:', myProfile.customId));
    peer.on('error', err => {
        if (err.type === 'unavailable-id') {
            show('profile-modal');
            showErr('setup-err',`"${myProfile.customId}" is taken. Choose another.`);
        }
    });
    peer.on('connection', conn => { isHost = true; setupConn(conn); });
    peer.on('call', handleIncomingCall);
}

function setupConn(conn) {
    conn.on('open', () => {
        connections[conn.peer] = conn;
        if (!currentPeerId) openChat(conn.peer);
        conn.send({ type:'profile-sync', profile:myProfile });
        sysMsg(`${conn.peer} connected`);
        if (isHost) broadcast({ type:'system', content:`${conn.peer} joined` }, conn.peer);
    });
    conn.on('data', d => handleData(d, conn.peer));
    conn.on('close', () => {
        delete connections[conn.peer];
        if (currentPeerId === conn.peer) {
            safeSet('chat-peer-status', el => { el.textContent='Offline'; el.className='peer-sub-text offline'; });
            safeSet('chat-online-dot', el => el.classList.add('hidden'));
        }
        sysMsg(`${peerProfiles[conn.peer]?.name || conn.peer} disconnected`);
        updateContactStatus(conn.peer, false);
        renderChatList();
    });
}

// ─── New Chat ───
$('new-chat-fab').onclick = () => show('newchat-modal');
$('close-newchat-modal').onclick = () => hide('newchat-modal');
$('newchat-connect-btn').onclick = () => {
    const id = $('newchat-peer-input').value.trim().toLowerCase();
    if (!id || id === myProfile.customId) { showErr('newchat-err','Invalid username.'); return; }
    isHost = false;
    const conn = peer.connect(id, { reliable:true });
    setupConn(conn);
    hide('newchat-modal');
    $('newchat-peer-input').value = '';
};

// ─── Data Handler ───
function handleData(data, from) {
    if (data.type === 'profile-sync') {
        peerProfiles[from] = data.profile;
        if (!isHost) connections[from]?.send({ type:'profile-sync', profile:myProfile });
        // Update contact
        updateContact(from, {
            name: data.profile.name, avatar: data.profile.avatar,
            status: data.profile.status, online: true
        });
        if (currentPeerId === from) updateChatHeader(from);
        updatePeerStatus(from, data.profile.status);
        renderChatList();
        updatePeerStatusList(from, data.profile);
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
    const senderName = peerProfiles[from]?.name || from;
    renderMsg(data, 'received', senderName, from);
    $('sound-msg-in').currentTime=0; $('sound-msg-in').play().catch(()=>{});
    if (document.hidden) document.title = '🔔 New Message – GhostChat';
    if (data.msgId) connections[from]?.send({ type:'read-receipt', msgId:data.msgId });
    if (isHost && data.type !== 'system') broadcast(data, from);

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
    if (!items.length) {
        list.innerHTML = `<li class="empty-state"><i class="fa-solid fa-ghost"></i><p>No conversations yet</p><small>Tap the ✉️ button below to start</small></li>`;
        return;
    }
    list.innerHTML = '';
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
        li.onclick = () => {
            // Try to connect if not connected
            if (!connections[peerId]?.open) {
                const conn = peer.connect(peerId, { reliable:true });
                isHost = false;
                setupConn(conn);
            }
            openChat(peerId);
        };
        list.appendChild(li);
    });
}

// ─── Peer Status (Status Tab) ───
function updatePeerStatusList(peerId, profile) {
    const list = $('peer-status-list');
    let item = document.getElementById(`status-item-${peerId}`);
    if (!item) {
        item = document.createElement('li');
        item.id = `status-item-${peerId}`;
        item.className = 'status-list-item';
        list.querySelectorAll('.empty-state').forEach(e=>e.remove());
        list.appendChild(item);
    }
    item.innerHTML = `
        <img src="${profile.avatar||defaultAvatar()}" alt="">
        <div class="status-item-text">
            <strong>${profile.name||peerId}</strong>
            <p>${profile.status||'No status'}</p>
            <small>Just now</small>
        </div>`;
}
function updatePeerStatus(peerId, status) {
    if (currentPeerId===peerId) {
        safeSet('chat-peer-status', el => {
            el.textContent = status || 'Online';
        });
    }
}

// ─── Status Feature ───
$('edit-my-status-btn').onclick = () => {
    $('status-input-area').classList.toggle('hidden');
    $('status-text-input').value = myProfile.status;
};
$('post-status-btn').onclick = saveStatus;

$('btn-update-status').onclick = () => {
    $('status-edit-box').classList.toggle('hidden');
    $('status-input-settings').value = myProfile.status;
};
$('save-status-btn').onclick = saveStatus;

function saveStatus() {
    const txt = ($('status-text-input').value || $('status-input-settings').value).trim();
    if (!txt) return;
    myProfile.status = txt;
    localStorage.setItem('gc_profile', JSON.stringify(myProfile));
    safeSet('my-status-text-display', el => el.textContent = txt);
    $('status-input-area').classList.add('hidden');
    $('status-edit-box').classList.add('hidden');
    // Broadcast status to connected peers
    broadcast({ type:'profile-sync', profile:myProfile });
}

// ─── Tabs ───
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
        btn.classList.add('active');
        $('tab-'+btn.dataset.tab).classList.add('active');
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
$('home-settings-btn').onclick = () => show('settings-modal');
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
    broadcast(payload);
    renderMsg(payload,'sent','Me', currentPeerId);
    $('sound-msg-out').currentTime=0; $('sound-msg-out').play().catch(()=>{});
    msgInput.value=''; msgInput.style.height='auto';
    $('send-btn').classList.add('hidden'); $('voice-btn').classList.remove('hidden');
    if (settings.imoTyping) broadcast({ type:'live-typing', content:'' });
    closeReply();
    const preview = text.length>40?text.substr(0,40)+'…':text;
    updateContact(currentPeerId, { lastMsg:preview, lastTime:Date.now() });
    renderChatList();
    if (currentPeerId) saveToHistory(currentPeerId, payload, 'sent', 'Me');
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
    else if (data.type==='audio') { const a=document.createElement('audio'); a.src=data.content; a.controls=true; body.appendChild(a); }
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
    if (align==='sent') {
        const da=document.createElement('span'); da.className='r-action del'; da.textContent='🗑 Delete';
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

function deleteMsgForAll(msgId) {
    const p={type:'delete-msg',msgId}; broadcast(p);
    const el=$(`msg-${msgId}`); if (el) el.innerHTML='<em style="opacity:.4">🚫 Deleted</em>';
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
    r.onload=e=>onLoad(e.target.result);
    if (onProgress) r.onprogress=e=>{ if(e.lengthComputable) onProgress(Math.round(e.loaded/e.total*100)); };
    r.readAsDataURL(f);
}
window.onfocus=()=>{ document.title='GhostChat – Private Messenger'; };

// ─── Boot ───
boot();
