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
    socket.on("quiz:started",payload=>{
      if(!currentRoom || payload.code!==currentRoom)return;
      quizState.items=payload.items||[];quizState.index=0;quizState.score=0;quizState.answered=false;
      if(payload.category)qel("quizCategory").value=payload.category;
      quizRender();
      notice(`${payload.started_by || "A buddy"} started a room quiz! Everyone has the same questions.`,true);
    });
    socket.on("quiz:next",payload=>{
      if(!currentRoom || payload.code!==currentRoom || !quizState.items.length)return;
      quizState.index=payload.index;quizState.answered=false;quizRender();
    });
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

  // Quiz questions are broadcast to everyone in the active room.
  const quizBank = {
    general: [
      {q:"Which is the largest ocean on Earth?",o:["Atlantic Ocean","Indian Ocean","Pacific Ocean","Arctic Ocean"],a:2,why:"The Pacific Ocean is the largest ocean by area."},
      {q:"How many sides does a hexagon have?",o:["Five","Six","Seven","Eight"],a:1,why:"A hexagon has six sides."},
      {q:"Which country is famous for the city of Kyoto?",o:["Japan","Thailand","Vietnam","Nepal"],a:0,why:"Kyoto is a historic city in Japan."},
      {q:"Which instrument measures temperature?",o:["Barometer","Thermometer","Altimeter","Compass"],a:1,why:"A thermometer measures temperature."},
      {q:"How many minutes are in two hours?",o:["90","100","120","180"],a:2,why:"Two hours contain 2 × 60 = 120 minutes."},
      {q:"Which one is a primary colour of light?",o:["Green","Brown","Pink","Black"],a:0,why:"In the RGB model of light, red, green and blue are primary colours."}
    ],
    science: [
      {q:"Which gas do plants absorb during photosynthesis?",o:["Oxygen","Carbon dioxide","Nitrogen","Hydrogen"],a:1,why:"Plants use carbon dioxide and water to produce sugars during photosynthesis."},
      {q:"What is the chemical symbol for gold?",o:["Ag","Gd","Au","Go"],a:2,why:"Gold's chemical symbol is Au, from the Latin aurum."},
      {q:"Which part of a cell contains most of its genetic material?",o:["Nucleus","Cell membrane","Cytoplasm","Ribosome"],a:0,why:"In eukaryotic cells, most DNA is stored in the nucleus."},
      {q:"Which force pulls objects toward Earth?",o:["Friction","Magnetism","Gravity","Buoyancy"],a:2,why:"Earth's gravitational attraction pulls objects toward its centre."},
      {q:"At standard atmospheric pressure, water boils at what temperature?",o:["0°C","50°C","100°C","150°C"],a:2,why:"At standard atmospheric pressure, water boils at 100°C."},
      {q:"Which organ pumps blood around the human body?",o:["Liver","Heart","Lung","Kidney"],a:1,why:"The heart contracts to circulate blood through the body."}
    ],
    tech: [
      {q:"What does CPU stand for?",o:["Central Processing Unit","Computer Power Utility","Core Program Upload","Central Program User"],a:0,why:"CPU stands for Central Processing Unit."},
      {q:"Which language is commonly used to style web pages?",o:["HTML","CSS","SQL","Python"],a:1,why:"CSS controls the presentation and styling of web pages."},
      {q:"What does URL identify?",o:["A web resource address","A computer's battery","A file's size","A Wi-Fi password"],a:0,why:"A URL identifies the location of a resource on a network."},
      {q:"Which data structure follows FIFO order?",o:["Stack","Queue","Tree","Graph"],a:1,why:"A queue processes items in first-in, first-out order."},
      {q:"Which of these is a relational database system?",o:["PostgreSQL","CSS","JPEG","Bluetooth"],a:0,why:"PostgreSQL is an open-source relational database management system."},
      {q:"What does HTTPS add to HTTP?",o:["Encrypted transport using TLS","More screen resolution","A larger keyboard","Offline storage only"],a:0,why:"HTTPS protects HTTP communication with TLS encryption and authentication."}
    ],
    fun: [
      {q:"Which of these is best for getting to know a new friend?",o:["Ask an open-ended question","Only say yes or no","Change the subject every second","Ignore their answer"],a:0,why:"Open-ended questions invite people to share more about themselves."},
      {q:"If your team gets a question wrong in a friendly quiz, what is a good response?",o:["Make fun of them","Blame one person","Learn the answer and keep playing","Quit immediately"],a:2,why:"A friendly game is more fun when everyone can learn and keep participating."},
      {q:"Which message is clearest when inviting someone to a room?",o:["Join sometime maybe","Use code ABC123 to join our room","You know what to do","Never mind"],a:1,why:"A specific instruction and the actual room code make joining clear."},
      {q:"Which is a good group-chat habit?",o:["Share private details without asking","Respect people's boundaries","Spam the same message","Pretend to be someone else"],a:1,why:"Respecting boundaries helps keep a group chat safe and welcoming."},
      {q:"What helps a group quiz feel fair?",o:["Change rules mid-round","Give everyone the same rules","Hide the questions from one player","Count only one person's answers"],a:1,why:"Consistent rules give all players a fair chance."},
      {q:"A friend gives a different opinion. What is a constructive response?",o:["Listen and ask why","Insult them","Stop them from speaking","Assume they are lying"],a:0,why:"Listening and asking respectfully helps people understand different perspectives."}
    ]
  };
  const quizState = {items:[],index:0,score:0,answered:false};
  const qel = id => document.getElementById(id);
  function shuffle(items){const a=items.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  function quizRender() {
    const progress=qel("quizProgress"), score=qel("quizScore"), bar=qel("quizProgressBar"), question=qel("quizQuestion"), options=qel("quizOptions"), feedback=qel("quizFeedback"), next=qel("nextQuestionBtn");
    score.textContent=`Score: ${quizState.score}`;
    bar.style.width=`${quizState.items.length ? (quizState.index/quizState.items.length)*100 : 0}%`;
    if(quizState.index>=quizState.items.length){
      progress.textContent="QUIZ COMPLETE";
      question.textContent=`You scored ${quizState.score} out of ${quizState.items.length}!`;
      options.innerHTML=`<div class="quiz-result">✨ ${quizState.score===quizState.items.length?"Perfect score! Amazing work!":quizState.score>=Math.ceil(quizState.items.length*.6)?"Nice job! Play again to beat your score.":"Good try! Give it another round."}</div>`;
      feedback.textContent="Choose a category and start again whenever you're ready.";
      next.textContent="Play again ↻";next.disabled=false;bar.style.width="100%";return;
    }
    const item=quizState.items[quizState.index];
    progress.textContent=`QUESTION ${quizState.index+1} OF ${quizState.items.length}`;
    question.textContent=item.q;
    options.innerHTML=item.o.map((label,i)=>`<button class="quiz-option" data-answer="${i}">${String.fromCharCode(65+i)}. ${safe(label)}</button>`).join("");
    options.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>quizAnswer(Number(btn.dataset.answer))));
    feedback.textContent="Choose the answer you think is right.";
    next.textContent=quizState.index===quizState.items.length-1?"See results →":"Next question →";next.disabled=true;
    quizState.answered=false;
  }
  function quizAnswer(selected) {
    if(quizState.answered)return;quizState.answered=true;
    const item=quizState.items[quizState.index];const buttons=qel("quizOptions").querySelectorAll("button");
    buttons.forEach((b,i)=>{b.disabled=true;if(i===item.a)b.classList.add("correct");else if(i===selected)b.classList.add("wrong");});
    if(selected===item.a){quizState.score++;qel("quizFeedback").textContent=`That's right! ${item.why}`;}
    else qel("quizFeedback").textContent=`Not quite. ${item.why}`;
    qel("quizScore").textContent=`Score: ${quizState.score}`;
    qel("quizProgressBar").style.width=`${((quizState.index+1)/quizState.items.length)*100}%`;
    qel("nextQuestionBtn").disabled=false;
  }
  qel("startQuizBtn").addEventListener("click",()=>{
    const category=qel("quizCategory").value;
    const items=shuffle(quizBank[category]).slice(0,6);
    if(currentRoom && socket?.connected){
      socket.emit("quiz:start",{code:currentRoom,client_id:clientId,category,items},response=>{
        if(!response?.ok)notice(response?.message||"Couldn't start the room quiz.");
      });
    } else {
      quizState.items=items;quizState.index=0;quizState.score=0;quizState.answered=false;quizRender();
    }
  });
  qel("nextQuestionBtn").addEventListener("click",()=>{
    if(quizState.index>=quizState.items.length){
      const category=qel("quizCategory").value;
      const items=shuffle(quizBank[category]).slice(0,6);
      if(currentRoom && socket?.connected){socket.emit("quiz:start",{code:currentRoom,client_id:clientId,category,items},r=>{if(!r?.ok)notice(r?.message||"Couldn't restart the room quiz.");});}
      else {quizState.index=0;quizState.score=0;quizState.items=items;quizRender();}
      return;
    }
    if(!quizState.answered)return;
    const nextIndex=quizState.index+1;
    if(currentRoom && socket?.connected){socket.emit("quiz:next",{code:currentRoom,client_id:clientId,index:nextIndex},r=>{if(!r?.ok)notice(r?.message||"Couldn't advance the room quiz.");});}
    else {quizState.index=nextIndex;quizRender();}
  });

})();
