const qs = (s) => document.querySelector(s);
let me = null;

async function api(url, opts={}) {
  const res = await fetch(url, { headers: {'Content-Type':'application/json'}, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function authView() {
  qs('#authPanel').innerHTML = `
    <h2>Login / Register</h2>
    <input id="user" placeholder="username">
    <input id="pass" placeholder="password" type="password">
    <input id="adminSecret" placeholder="admin secret (optional)">
    <button onclick="login()">Login</button>
    <button onclick="register()">Register</button>
    <p class="small">New users get starter cards automatically.</p>
  `;
}

function renderAuthBar() {
  qs('#authBar').innerHTML = me ? `<b>${me.username}</b> | Points: ${me.points} | Free: ${me.free_packs} | Bonus: ${me.bonus_packs} | Luck: ${me.luck_boost} <button onclick="logout()">Logout</button>` : '';
}

async function register() {
  try {
    await api('/api/register', { method:'POST', body: JSON.stringify({ username: qs('#user').value, password: qs('#pass').value })});
    await boot();
  } catch(e){ alert(e.message); }
}
async function login() {
  try {
    await api('/api/login', { method:'POST', body: JSON.stringify({ username: qs('#user').value, password: qs('#pass').value, adminSecret: qs('#adminSecret').value })});
    await boot();
  } catch(e){ alert(e.message); }
}
async function logout() { await api('/api/logout', {method:'POST'}); location.reload(); }

async function boot() {
  const info = await api('/api/me');
  me = info.user;
  renderAuthBar();
  if (!me) return authView();
  qs('#authPanel').classList.add('hidden');
  qs('#gamePanel').classList.remove('hidden');
  switchTab('collection');
}

async function switchTab(tab) {
  const el = qs('#tabContent');
  if (tab === 'collection') {
    const data = await api('/api/cards/mine');
    el.innerHTML = `<h2>Your Collection (${data.cards.length})</h2>
      <p>Set hand slots by entering 7 owned user_card_id values (comma-separated).</p>
      <input id="handIds" style="width:90%" placeholder="e.g. 1,2,3,4,5,6,7"><button onclick="saveHand()">Save Hand</button>
      <div class="grid">${data.cards.map(c=>cardHtml(c,true)).join('')}</div>`;
  }
  if (tab === 'packs') {
    el.innerHTML = `<h2>Open Pack (7 cards)</h2>
      <select id="packType"><option value="points">Points (120)</option><option value="free">Free</option><option value="bonus">Bonus</option></select>
      <input id="codeword" placeholder="optional codeword e.g. politics">
      <label><input id="useLuck" type="checkbox">Use luck boost charge</label>
      <button onclick="openPack()">Open</button>
      <div id="packResults" class="grid"></div>`;
  }
  if (tab === 'missions') {
    const data = await api('/api/missions');
    el.innerHTML = `<h2>Single Player Missions</h2>
      <p>Cooldown: ${data.cooldownSeconds}s (admins bypass). Harsh judging, better rewards.</p>
      <select id="missionId">${data.missions.map(m=>`<option value="${m.id}">${m.title} (Diff ${m.difficulty}) - ${m.prompt}</option>`).join('')}</select>
      <input id="missionCards" style="width:90%" placeholder="7 user_card_ids comma separated">
      <textarea id="missionReason" placeholder="Explain why your team is a good fit"></textarea>
      <button onclick="runMission()">Attempt Mission</button>`;
  }
  if (tab === 'pvp') {
    el.innerHTML = `<h2>PvP Queue</h2><p>Moderate judging. Submit your 7-card team and get auto-matched.</p>
      <input id="pvpCards" style="width:90%" placeholder="7 user_card_ids comma separated">
      <textarea id="pvpReason" placeholder="Team strategy"></textarea>
      <button onclick="queuePvp()">Queue</button>`;
  }
  if (tab === 'trades') {
    const inc = await api('/api/trades/incoming');
    el.innerHTML = `<h2>Direct Trades</h2>
      <h3>Propose Trade</h3>
      <input id="toUser" placeholder="recipient username">
      <input id="offerId" placeholder="your user_card_id">
      <input id="wantId" placeholder="their user_card_id">
      <button onclick="proposeTrade()">Send</button>
      <h3>Incoming</h3>
      ${inc.trades.map(t=>`<div>#${t.id} from ${t.from_user_id} offer:${t.offered_user_card_id} want:${t.requested_user_card_id}
      <button onclick="respondTrade(${t.id},true)">Accept</button><button onclick="respondTrade(${t.id},false)">Decline</button></div>`).join('') || '<p>No pending trades</p>'}`;
  }
  if (tab === 'submit') {
    el.innerHTML = cardForm('submitCard()', 'Submit for Approval');
  }
  if (tab === 'admin') {
    if (!me.is_admin) { el.innerHTML = '<h2>Admin only</h2>'; return; }
    const sub = await api('/api/admin/submissions');
    el.innerHTML = `<h2>Admin Console</h2>${cardForm('createCard()', 'Create Approved Card')}
      <h3>Pending Submissions</h3>
      ${sub.submissions.map(s=>`<div>#${s.id} ${s.name} (tier ${s.tier}) <button onclick="approve(${s.id})">Approve</button></div>`).join('') || '<p>None</p>'}`;
  }
}

function cardForm(action, label) {
  return `<input id="name" placeholder="name"><input id="title" placeholder="title"><input id="source" placeholder="source"><input id="imageUrl" placeholder="image url or /assets/file.png"><input id="tier" type="number" min="0" max="7" placeholder="tier"><input id="codewords" placeholder="codewords comma separated"><input id="cardNumber" placeholder="card number"><textarea id="quote" placeholder="quote"></textarea><button onclick="${action}">${label}</button>`;
}

function cardHtml(c, showId=false) {
  return `<div class="card"><img src="${c.image_url}"><div class="meta"><b>${c.name}</b><div>${c.title}</div><div>Tier ${c.tier}</div><div>"${c.quote}"</div><div class="small">${c.source} • ${c.card_number}${showId?` • user_card_id:${c.user_card_id}`:''}</div></div></div>`;
}

function parseIds(s){ return s.split(',').map(x=>x.trim()).filter(Boolean).map(Number); }
async function saveHand(){ try{ const ids=parseIds(qs('#handIds').value); if(ids.length!==7) throw new Error('Need 7 ids'); await api('/api/hand',{method:'POST',body:JSON.stringify({slots:ids})}); alert('Saved'); }catch(e){alert(e.message);} }
async function openPack(){ try{const d=await api('/api/packs/open',{method:'POST',body:JSON.stringify({type:qs('#packType').value,codeword:qs('#codeword').value,useLuck:qs('#useLuck').checked})}); qs('#packResults').innerHTML=d.draws.map(c=>cardHtml(c)).join(''); await boot();}catch(e){alert(e.message);} }
async function runMission(){ try{const d=await api('/api/missions/attempt',{method:'POST',body:JSON.stringify({missionId:Number(qs('#missionId').value),userCardIds:parseIds(qs('#missionCards').value),reasoning:qs('#missionReason').value})}); alert(`${d.judged.result} score:${d.judged.score}`); await boot();}catch(e){alert(e.message);} }
async function queuePvp(){ try{const d=await api('/api/pvp/queue',{method:'POST',body:JSON.stringify({userCardIds:parseIds(qs('#pvpCards').value),reasoning:qs('#pvpReason').value})}); alert(d.matched?`Matched. Winner user id: ${d.winnerUserId}`:'Queued, wait for opponent'); await boot();}catch(e){alert(e.message);} }
async function proposeTrade(){ try{await api('/api/trades/propose',{method:'POST',body:JSON.stringify({toUsername:qs('#toUser').value,offeredUserCardId:Number(qs('#offerId').value),requestedUserCardId:Number(qs('#wantId').value)})}); alert('Trade sent');}catch(e){alert(e.message);} }
async function respondTrade(id,accept){ try{await api('/api/trades/respond',{method:'POST',body:JSON.stringify({tradeId:id,accept})}); switchTab('trades');}catch(e){alert(e.message);} }
async function submitCard(){ try{await api('/api/cards/submit',{method:'POST',body:JSON.stringify(formData())}); alert('Submitted');}catch(e){alert(e.message);} }
async function createCard(){ try{await api('/api/admin/cards',{method:'POST',body:JSON.stringify(formData())}); alert('Created');}catch(e){alert(e.message);} }
async function approve(id){ await api(`/api/admin/submissions/${id}/approve`,{method:'POST'}); switchTab('admin'); }
function formData(){ return {name:qs('#name').value,title:qs('#title').value,source:qs('#source').value,imageUrl:qs('#imageUrl').value,tier:Number(qs('#tier').value),codewords:qs('#codewords').value,cardNumber:qs('#cardNumber').value,quote:qs('#quote').value}; }

document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
boot();
