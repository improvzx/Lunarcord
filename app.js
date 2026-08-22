const $ = s => document.querySelector(s);
const SERVER_URL = window.LUNARCORD_SERVER_URL || 'http://localhost:3000';
const socket = io(SERVER_URL);
const peers = new Map();
const names = new Map();
let localStream, roomId, myName, screenStream;
let micOn = true, camOn = true;
let selectedOutputId = '';
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };

async function prepareMedia() {
  localStream = new MediaStream();
  const problems = [];
  try {
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioStream.getAudioTracks().forEach(track => localStream.addTrack(track));
  } catch (_error) { problems.push('microfone'); }
  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    videoStream.getVideoTracks().forEach(track => localStream.addTrack(track));
  } catch (error) { problems.push('câmera'); console.error('Erro da câmera:', error.name, error.message); }
  $('#local-video').srcObject = localStream;
  $('#status').textContent = problems.length ? `Não foi possível abrir: ${problems.join(' e ')}` : 'Câmera e microfone ativos';
}

function renderPeople() {
  $('#people').innerHTML = `<div class="person">${escapeHtml(myName)} (você)</div>` +
    [...names.values()].map(name => `<div class="person">${escapeHtml(name)}</div>`).join('');
}

function createPeer(id, initiator) {
  if (peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection(rtcConfig);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.onicecandidate = e => e.candidate && socket.emit('signal', { to: id, data: { candidate: e.candidate } });
  pc.ontrack = e => addRemoteVideo(id, e.streams[0]);
  pc.onconnectionstatechange = () => ['failed','closed','disconnected'].includes(pc.connectionState) && removePeer(id);
  peers.set(id, pc);
  if (initiator) pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => socket.emit('signal', { to: id, data: { description: pc.localDescription } }));
  return pc;
}

async function handleSignal(from, data) {
  const pc = createPeer(from, false);
  if (data.description) {
    await pc.setRemoteDescription(data.description);
    if (data.description.type === 'offer') {
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      socket.emit('signal', { to: from, data: { description: pc.localDescription } });
    }
  } else if (data.candidate) await pc.addIceCandidate(data.candidate).catch(() => {});
}

function addRemoteVideo(id, stream) {
  let card = document.getElementById(`peer-${id}`);
  if (!card) {
    card = document.createElement('div'); card.id = `peer-${id}`; card.className = 'video-card';
    card.innerHTML = `<video autoplay playsinline></video><span></span><button type="button" title="Tela cheia" style="position:absolute;top:10px;right:10px;z-index:5;width:42px;height:36px;border:0;border-radius:8px;background:#000b;color:#fff;font-size:21px;cursor:pointer">⛶</button>`;
    card.querySelector('button').onclick = () => card.requestFullscreen?.().catch(() => {});
    $('#videos').appendChild(card);
  }
  const video = card.querySelector('video'); video.srcObject = stream; card.querySelector('span').textContent = names.get(id) || 'Participante';
  if (selectedOutputId && typeof video.setSinkId === 'function') video.setSinkId(selectedOutputId).catch(() => {});
}

$('#videos').addEventListener('dblclick', event => {
  const card = event.target.closest('.video-card');
  if (!card) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else card.requestFullscreen?.().catch(() => {});
});

function removePeer(id) { peers.get(id)?.close(); peers.delete(id); names.delete(id); document.getElementById(`peer-${id}`)?.remove(); renderPeople(); }
function escapeHtml(v) { const d=document.createElement('div'); d.textContent=v; return d.innerHTML; }

$('#join-form').addEventListener('submit', async e => {
  e.preventDefault(); myName=$('#name').value.trim(); roomId=$('#room').value.trim();
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#my-name').textContent=myName; $('#avatar').textContent=myName[0].toUpperCase(); $('#room-label').textContent=roomId;
  await prepareMedia(); renderPeople(); socket.emit('join-room', { roomId, name: myName });
});
$('#random-room').onclick = () => $('#room').value = Math.random().toString(36).slice(2,8).toUpperCase();
socket.on('room-users', users => users.forEach(u => { names.set(u.id,u.name); createPeer(u.id,true); renderPeople(); }));
socket.on('user-joined', u => { names.set(u.id,u.name); renderPeople(); });
socket.on('signal', ({from,data}) => handleSignal(from,data));
socket.on('user-left', removePeer);

$('#mic').onclick = () => { micOn=!micOn; localStream.getAudioTracks().forEach(t=>t.enabled=micOn); $('#mic').classList.toggle('off',!micOn); };
$('#cam').onclick = async () => {
  let track=localStream.getVideoTracks()[0];
  if (!track) {
    try { const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false}); track=stream.getVideoTracks()[0]; localStream.addTrack(track); $('#local-video').srcObject=localStream; peers.forEach((pc,id)=>{pc.addTrack(track,localStream); renegotiate(pc,id);}); camOn=true; $('#status').textContent='Câmera ativada'; }
    catch(error){ $('#status').textContent=`Câmera bloqueada ou ocupada (${error.name})`; return; }
  } else { camOn=!camOn; track.enabled=camOn; }
  $('#cam').classList.toggle('off',!camOn);
};
$('#screen').onclick = async () => {
  if (screenStream) return stopScreen();
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:true });
    const track = screenStream.getVideoTracks()[0];
    peers.forEach((pc, id) => {
      const sender = pc.getSenders().find(item => item.track?.kind === 'video');
      if (sender) pc.removeTrack(sender);
      pc.addTrack(track, screenStream);
      renegotiate(pc, id);
    });
    $('#local-video').srcObject=screenStream; $('#screen').classList.add('off'); $('#status').textContent='Compartilhando sua tela'; track.onended=stopScreen;
  } catch (error) {
    $('#status').textContent='O compartilhamento foi cancelado ou bloqueado pelo Windows';
    console.error('Erro ao compartilhar tela:', error);
  }
};
function stopScreen(){
  if(!screenStream)return;
  const camera=localStream.getVideoTracks()[0];
  peers.forEach((pc, id) => {
    const sender = pc.getSenders().find(item => item.track?.kind === 'video');
    if (sender) pc.removeTrack(sender);
    if (camera) pc.addTrack(camera, localStream);
    renegotiate(pc, id);
  });
  screenStream.getTracks().forEach(t=>t.stop()); screenStream=null; $('#local-video').srcObject=localStream; $('#screen').classList.remove('off'); $('#status').textContent='Câmera e microfone ativos';
}
$('#chat-form').onsubmit=e=>{e.preventDefault();const text=$('#message').value.trim();if(text){socket.emit('chat-message',text);$('#message').value='';}};
socket.on('chat-message',m=>{const d=document.createElement('div');d.className='msg';d.innerHTML=`<b>${escapeHtml(m.name)}</b><time>${new Date(m.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time><p>${escapeHtml(m.text)}</p>`;$('#messages').appendChild(d);d.scrollIntoView();});
$('#copy-room').onclick=async()=>{await navigator.clipboard.writeText(roomId);$('#copy-room').textContent='Copiado!';setTimeout(()=>$('#copy-room').textContent='Copiar código',1200)};
$('#leave').onclick=()=>location.reload();

const deviceSelects = { audioinput: $('#audio-input'), audiooutput: $('#audio-output'), videoinput: $('#video-input') };
async function loadDeviceOptions() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const counters = { audioinput: 0, audiooutput: 0, videoinput: 0 };
  Object.values(deviceSelects).forEach(select => select.innerHTML = '');
  devices.forEach(device => {
    const select = deviceSelects[device.kind]; if (!select) return;
    counters[device.kind]++;
    const option = document.createElement('option'); option.value = device.deviceId;
    const fallback = device.kind === 'audioinput' ? 'Microfone' : device.kind === 'audiooutput' ? 'Saída de som' : 'Câmera';
    option.textContent = device.label || `${fallback} ${counters[device.kind]}`; select.appendChild(option);
  });
  const audioTrack = localStream?.getAudioTracks()[0], videoTrack = localStream?.getVideoTracks()[0];
  if (audioTrack?.getSettings().deviceId) $('#audio-input').value = audioTrack.getSettings().deviceId;
  if (videoTrack?.getSettings().deviceId) $('#video-input').value = videoTrack.getSettings().deviceId;
  if (selectedOutputId) $('#audio-output').value = selectedOutputId;
  $('#output-hint').textContent = typeof HTMLMediaElement.prototype.setSinkId === 'function' ? '' : 'O Windows controlará a saída de som.';
}
async function loadCaptureSources() {
  const select = $('#capture-source'); select.innerHTML = '';
  const sources = await window.lunarcord.getCaptureSources();
  sources.forEach(source => { const option=document.createElement('option'); option.value=source.id; option.textContent=source.name; select.appendChild(option); });
}
async function replaceLocalTrack(kind, deviceId) {
  if (!deviceId) return;
  const constraints = kind === 'audio' ? { audio: { deviceId: { exact: deviceId } }, video: false } : { video: { deviceId: { exact: deviceId } }, audio: false };
  const newStream = await navigator.mediaDevices.getUserMedia(constraints);
  const newTrack = kind === 'audio' ? newStream.getAudioTracks()[0] : newStream.getVideoTracks()[0];
  const oldTrack = kind === 'audio' ? localStream.getAudioTracks()[0] : localStream.getVideoTracks()[0];
  newTrack.enabled = kind === 'audio' ? micOn : camOn;
  peers.forEach((pc,id) => { const sender=pc.getSenders().find(item => item.track?.kind === kind); if(sender) sender.replaceTrack(newTrack); else { pc.addTrack(newTrack,localStream); renegotiate(pc,id); } });
  if (oldTrack) { localStream.removeTrack(oldTrack); oldTrack.stop(); }
  localStream.addTrack(newTrack); $('#local-video').srcObject = localStream;
}
$('#settings').onclick = async () => {
  $('#settings-modal').classList.remove('hidden');
  try { await Promise.all([loadDeviceOptions(), loadCaptureSources()]); }
  catch (_error) { $('#status').textContent = 'Não foi possível listar todos os dispositivos'; }
};
$('#close-settings').onclick = () => $('#settings-modal').classList.add('hidden');
$('#settings-modal').onclick = e => { if (e.target.id === 'settings-modal') $('#settings-modal').classList.add('hidden'); };
$('#apply-settings').onclick = async () => {
  const button=$('#apply-settings'); button.disabled=true; button.textContent='Aplicando...';
  try {
    const currentAudio=localStream.getAudioTracks()[0]?.getSettings().deviceId;
    const currentVideo=localStream.getVideoTracks()[0]?.getSettings().deviceId;
    if ($('#audio-input').value && $('#audio-input').value !== currentAudio) await replaceLocalTrack('audio', $('#audio-input').value);
    if ($('#video-input').value && $('#video-input').value !== currentVideo) await replaceLocalTrack('video', $('#video-input').value);
    selectedOutputId=$('#audio-output').value;
    await Promise.all([...document.querySelectorAll('.video-card:not(.local) video')].map(video => selectedOutputId && video.setSinkId ? video.setSinkId(selectedOutputId) : Promise.resolve()));
    window.lunarcord.selectCaptureSource($('#capture-source').value);
    $('#status').textContent='Configurações aplicadas'; $('#settings-modal').classList.add('hidden');
  } catch (_error) { $('#status').textContent='Não foi possível trocar um dos dispositivos'; }
  finally { button.disabled=false; button.textContent='Aplicar configurações'; }
};
navigator.mediaDevices.addEventListener?.('devicechange', () => !$('#settings-modal').classList.contains('hidden') && loadDeviceOptions());

function renegotiate(pc, id) { pc.createOffer().then(offer=>pc.setLocalDescription(offer)).then(()=>socket.emit('signal',{to:id,data:{description:pc.localDescription}})).catch(()=>{}); }

let authToken=localStorage.getItem('lunarcordToken')||'', account=null, verificationEmail='', selectedServer=null;
async function api(route, options={}) {
  const response=await fetch(`${SERVER_URL}/api${route}`,{...options,headers:{'Content-Type':'application/json',...(authToken?{Authorization:`Bearer ${authToken}`}:{})}});
  const data=await response.json(); if(!response.ok){const error=new Error(data.error||'Não foi possível concluir.');error.data=data;throw error;} return data;
}
function enterAccount(data){ authToken=data.token;account=data.user;localStorage.setItem('lunarcordToken',authToken);$('#auth').classList.add('hidden');$('#login').classList.remove('hidden');$('#name').value=account.username;$('#account-label').textContent=`${account.username} • ${account.email}`; }
function authMessage(text,error=false){$('#auth-message').textContent=text;$('#auth-message').classList.toggle('error',error);}
$('#switch-auth').onclick=()=>{const registering=$('#register-form').classList.contains('hidden');$('#login-form').classList.toggle('hidden',registering);$('#register-form').classList.toggle('hidden',!registering);$('#verify-form').classList.add('hidden');$('#switch-auth').textContent=registering?'Já tenho uma conta':'Criar uma conta';authMessage('');};
$('#login-form').onsubmit=async e=>{e.preventDefault();try{const data=await api('/login',{method:'POST',body:JSON.stringify({email:$('#login-email').value,password:$('#login-password').value})});enterAccount(data);}catch(error){if(error.data?.needsVerification){verificationEmail=$('#login-email').value;$('#login-form').classList.add('hidden');$('#verify-form').classList.remove('hidden');$('#switch-auth').classList.add('hidden');authMessage('Conta encontrada. Reenvie o código para confirmar.');}else authMessage(error.message,true);}};
$('#register-form').onsubmit=async e=>{e.preventDefault();try{verificationEmail=$('#register-email').value;const data=await api('/register',{method:'POST',body:JSON.stringify({username:$('#register-name').value,email:verificationEmail,password:$('#register-password').value})});$('#register-form').classList.add('hidden');$('#verify-form').classList.remove('hidden');$('#switch-auth').classList.add('hidden');authMessage(data.developmentCode?`Modo de teste: seu código é ${data.developmentCode}`:'Código enviado para seu e-mail.');}catch(error){authMessage(error.message,true);}};
$('#verify-form').onsubmit=async e=>{e.preventDefault();try{const data=await api('/verify',{method:'POST',body:JSON.stringify({email:verificationEmail,code:$('#verify-code').value})});enterAccount(data);}catch(error){authMessage(error.message,true);}};
$('#resend-code').onclick=async()=>{try{const data=await api('/resend-code',{method:'POST',body:JSON.stringify({email:verificationEmail})});authMessage(data.developmentCode?`Modo de teste: código ${data.developmentCode}`:'Novo código enviado. Verifique também o Spam.');}catch(error){authMessage(error.message,true);}};

async function loadSocial(){const data=await api('/me');account=data.user;$('#account-label').textContent=`${account.username} • ${account.email}`;$('#friends-list').innerHTML=data.friends.map(u=>`<div class="friend-row"><span>● ${escapeHtml(u.username)}</span><small>${escapeHtml(u.email)}</small></div>`).join('')||'<p class="form-message">Nenhum amigo ainda.</p>';$('#friend-requests').innerHTML=data.requests.map(u=>`<div class="request-row"><span>${escapeHtml(u.username)}</span><button data-accept="${u.id}">Aceitar</button></div>`).join('');$('#servers-list').innerHTML=data.servers.map(s=>`<div class="server-row" data-server="${s.id}"><div><b>${escapeHtml(s.name)}</b><small> Convite: ${s.inviteCode}</small></div><button>Usar sala</button></div>`).join('')||'<p class="form-message">Nenhum servidor ainda.</p>';$('#friend-requests').querySelectorAll('[data-accept]').forEach(b=>b.onclick=async()=>{await api('/friends/accept',{method:'POST',body:JSON.stringify({userId:b.dataset.accept})});loadSocial();});$('#servers-list').querySelectorAll('[data-server]').forEach(row=>row.onclick=async()=>{selectedServer=await api(`/servers/${row.dataset.server}`);$('#room').value=selectedServer.id;$('#role-panel').classList.toggle('hidden',selectedServer.ownerId!==account.id);$('#role-member').innerHTML=selectedServer.members.filter(m=>m.userId!==account.id).map(m=>`<option value="${m.userId}">${escapeHtml(m.user.username)}</option>`).join('');$('#role-choice').innerHTML=selectedServer.roles.filter(r=>r.id!=='owner').map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');$('#social-message').textContent=`${selectedServer.name} selecionado como sala.`;});}
$('#community').onclick=async()=>{$('#community-modal').classList.remove('hidden');try{await loadSocial();}catch(error){$('#social-message').textContent=error.message;}};
$('#close-community').onclick=()=>$('#community-modal').classList.add('hidden');
$('#friend-form').onsubmit=async e=>{e.preventDefault();try{await api('/friends/request',{method:'POST',body:JSON.stringify({email:$('#friend-email').value})});$('#social-message').textContent='Pedido de amizade enviado.';$('#friend-email').value='';}catch(error){$('#social-message').textContent=error.message;}};
$('#server-form').onsubmit=async e=>{e.preventDefault();try{await api('/servers',{method:'POST',body:JSON.stringify({name:$('#server-name').value})});$('#server-name').value='';await loadSocial();}catch(error){$('#social-message').textContent=error.message;}};
$('#join-server-form').onsubmit=async e=>{e.preventDefault();try{await api('/servers/join',{method:'POST',body:JSON.stringify({inviteCode:$('#invite-code').value})});$('#invite-code').value='';await loadSocial();}catch(error){$('#social-message').textContent=error.message;}};
$('#create-role').onclick=async()=>{if(!selectedServer)return;const permissions=[...document.querySelectorAll('.permissions input:checked')].map(x=>x.value);try{await api(`/servers/${selectedServer.id}/roles`,{method:'POST',body:JSON.stringify({name:$('#role-name').value,permissions})});$('#social-message').textContent='Cargo criado.';$('#role-name').value='';}catch(error){$('#social-message').textContent=error.message;}};
$('#assign-role').onclick=async()=>{if(!selectedServer||!$('#role-member').value)return;try{await api(`/servers/${selectedServer.id}/members/${$('#role-member').value}/role`,{method:'PUT',body:JSON.stringify({roleId:$('#role-choice').value})});$('#social-message').textContent='Cargo aplicado ao membro.';}catch(error){$('#social-message').textContent=error.message;}};
$('#logout').onclick=()=>{localStorage.removeItem('lunarcordToken');location.reload();};
(async()=>{if(authToken){try{const data=await api('/me');enterAccount({token:authToken,user:data.user});}catch{localStorage.removeItem('lunarcordToken');}}})();
