(() => {
  const apiUrl = (window.BRAINBUDDY_API_URL || "").replace(/\/+$/, "");
  const $ = (id) => document.getElementById(id);
  const els = {
    connectionText: $("connectionText"), name: $("displayName"), code: $("roomCode"),
    create: $("createBtn"), join: $("joinBtn"), notice: $("notice"),
    roomTitle: $("roomTitle"), roomSubtitle: $("roomSubtitle"), codeDisplay: $("roomCodeDisplay"),
    copy: $("copyBtn"), members: $("membersList"), memberCount: $("memberCount"),
    messages: $("chatMessages"), chatForm: $("chatForm"), chatInput: $("chatInput"), send: $("sendBtn")
  };
  const storedId = localStorage.getItem("brainbuddy_client_id");
  const clientId = storedId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  localStorage.setItem("brainbuddy_client_id", clientId);
  let socket = null, currentRoom = null, myMemberId = null, members = [], history = [], reconnecting = false;
  const palette = ["", "c2", "c3", "c4"];
  const face = (name) => (name.trim().charAt(0) || "B").toUpperCase();
  const safe = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function notice(message, success=false) {
    els.notice.textContent = message;
    els.notice.className = `notice show${success ? " success" : ""}`;
  }
  function clearNotice(){els.notice.className="notice";els.notice.textContent="";}
  function displayRoom(room) {
    currentRoom = room.code; myMemberId = room.member_id || myMemberId;
    els.code.value = room.code; els.codeDisplay.textContent = room.code;
    els.roomTitle.textContent = "Your buddy room";
    els.roomSubtitle.textContent = "You're in! Share the code with your friends.";
    els.copy.disabled = false; els.chatInput.disabled = false; els.send.disabled = false;
  }
  function renderMembers() {
    els.memberCount.textContent = members.length;
    if (!members.length) {
      els.members.innerHTML = '<div class="empty-state"><span>🫧</span><strong>No members yet</strong><p>Share your room code with a friend.</p></div>'; return;
    }
    els.members.innerHTML = members.map((m,i)=>`<div class="member"><div class="avatar ${palette[i%palette.length]}">${safe(face(m.name))}</div><div class="member-info"><div class="member-name">${safe(m.name)}${m.client_id===clientId?'<span class="member-you">YOU</span>':''}</div><div class="member-status">● Online</div></div></div>`).join("");
  }
  function renderMessages() {
    if (!history.length) {els.messages.innerHTML='<div class="chat-empty">The conversation starts here 💌</div>';return;}
    els.messages.innerHTML = history.map(m=>`<div class="message ${m.client_id===clientId?'mine':''}"><div class="message-author">${safe(m.name)}</div><div class="message-body">${safe(m.body)}</div><div class="message-time">${safe(m.created_at ? new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '')}</div></div>`).join("");
    els.messages.scrollTop=els.messages.scrollHeight;
  }
  function setConnected(ok) {
    els.connectionText.textContent = ok ? "Connected" : "Reconnecting…";
    document.querySelector(".status-dot").classList.toggle("online",ok);
  }
  function connect() {
    if (!apiUrl || apiUrl.includes("YOUR-RENDER-SERVICE")) {
      setConnected(false); notice("Add your Render backend URL in frontend/config.js before deploying."); return;
    }
    if (socket) socket.disconnect();
    socket = io(apiUrl, { transports:["websocket","polling"], reconnection:true, reconnectionAttempts:Infinity, timeout:20000 });
    socket.on("connect",()=>{setConnected(true);if(currentRoom){socket.emit("room:join",{code:currentRoom,name:els.name.value.trim()||"Buddy",client_id:clientId},handleRoomResponse);}});
    socket.on("disconnect",()=>setConnected(false));
    socket.on("connect_error",()=>{setConnected(false);});
    socket.on("room:members",payload=>{if(payload.code===currentRoom){members=payload.members||[];renderMembers();}});
    socket.on("chat:history",payload=>{if(payload.code===currentRoom){history=payload.messages||[];renderMessages();}});
    socket.on("chat:new",payload=>{if(payload.code===currentRoom){history.push(payload.message);history=history.slice(-200);renderMessages();}});
    socket.on("room:error",payload=>notice(payload.message||"Room error."));
  }
  function handleRoomResponse(response) {
    if(!response || !response.ok){notice(response?.message||"Couldn't join this room.");return;}
    clearNotice();displayRoom(response.room);members=response.members||[];history=response.messages||[];renderMembers();renderMessages();
  }
  function requireName() {
    const name=els.name.value.trim();
    if(!name){els.name.focus();notice("Add your name first so your friends know who's joining.");return null;}
    if(name.length>24){notice("Keep your name to 24 characters or fewer.");return null;}
    return name;
  }
  function createRoom() {
    const name=requireName();if(!name)return;
    if(!socket?.connected){notice("Backend isn't connected yet. Check your Render URL and try again.");return;}
    els.create.disabled=true;els.create.textContent="Creating…";
    socket.emit("room:create",{name,client_id:clientId},r=>{handleRoomResponse(r);els.create.disabled=false;els.create.innerHTML="<span>✦</span> Create a room";});
  }
  function joinRoom() {
    const name=requireName();if(!name)return;
    const code=els.code.value.trim().toUpperCase();
    if(!code){notice("Enter your friend's room code first.");return;}
    if(!socket?.connected){notice("Backend isn't connected yet. Check your Render URL and try again.");return;}
    socket.emit("room:join",{code,name,client_id:clientId},handleRoomResponse);
  }
  els.create.addEventListener("click",createRoom);
  els.join.addEventListener("click",joinRoom);
  els.copy.addEventListener("click",async()=>{if(!currentRoom)return;try{await navigator.clipboard.writeText(currentRoom);notice("Room code copied — send it to your friend!",true);}catch{els.code.select();notice("Select and copy the room code above.",true);}});
  els.code.addEventListener("input",()=>{els.code.value=els.code.value.toUpperCase().replace(/[^A-Z0-9]/g,"");});
  els.chatForm.addEventListener("submit",e=>{e.preventDefault();const body=els.chatInput.value.trim();if(!body||!currentRoom||!socket?.connected)return;socket.emit("chat:send",{code:currentRoom,body,client_id:clientId},r=>{if(r?.ok)els.chatInput.value="";else notice(r?.message||"Message wasn't sent.");});});
  els.name.value=localStorage.getItem("brainbuddy_display_name")||"";
  els.name.addEventListener("change",()=>localStorage.setItem("brainbuddy_display_name",els.name.value.trim()));
  connect();
})();
