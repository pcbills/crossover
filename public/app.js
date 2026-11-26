/* Crossover — phone client. Renders whatever state the server sends us. */
(() => {
  const socket = io();
  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal');
  const $toast = document.getElementById('toast');
  const $topRight = document.getElementById('topbar-right');

  const SESSION_KEY = 'crossover-session';
  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') || '').toUpperCase();

  let state = null; // latest view from the server
  let categories = [];
  let session = loadSession();
  let resuming = !!session;

  // Local, unsent UI bits that must survive re-renders.
  const ui = {
    name: localStorage.getItem('crossover-name') || '',
    code: urlRoom,
    categories: ['everything'],
    rounds: 5,
    customDraft: '',
    draft: '',
    draftKey: null,
    ranking: [],
    rankingKey: null,
    busy: false,
  };

  // ---------- helpers ----------

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  }
  function saveSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  let toastTimer;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.add('hidden'), 3000);
  }

  function send(event, payload = {}) {
    return new Promise((resolve) => {
      socket.timeout(8000).emit(event, payload, (err, res) => {
        if (err) res = { ok: false, error: 'Connection problem — try again.' };
        if (!res.ok) toast(res.error);
        resolve(res);
      });
    });
  }

  function catLabel(ids) {
    return ids.map((id) => {
      const c = categories.find((c) => c.id === id);
      return c ? `${c.emoji} ${c.label}` : id;
    }).join(' + ');
  }

  // Tapping a category toggles it. "Everything" stands alone: picking it clears
  // the others, picking anything else clears it, and unpicking the last one
  // falls back to it.
  function toggleCategory(current, id) {
    if (id === 'everything') return ['everything'];
    const rest = current.filter((c) => c !== 'everything');
    const next = rest.includes(id) ? rest.filter((c) => c !== id) : [...rest, id];
    return next.length ? next : ['everything'];
  }

  // ---------- connection ----------

  socket.on('connect', async () => {
    if (session && (!urlRoom || urlRoom === session.code)) {
      resuming = true;
      render();
      const res = await send('resume', session);
      if (!res.ok) saveSession(null);
    }
    resuming = false;
    render();
  });

  socket.on('disconnect', () => render());

  socket.on('state', (s) => {
    const prev = state;
    state = s;
    const rerolled = prev && prev.phase === 'writing' && s.phase === 'writing' &&
      prev.round === s.round && s.rerolls > prev.rerolls;
    if (rerolled && !s.isAdmin) toast('🎲 New pairing! Write a fresh line.');
    // Close the re-roll confirmation if the round moved on underneath it.
    if ($modal.dataset.kind === 'reroll' && (s.phase !== 'writing' || rerolled)) closeModal();
    render();
  });

  socket.on('kicked', () => {
    saveSession(null);
    state = null;
    toast('You were removed from the game.');
    render();
  });

  fetch('/api/categories').then((r) => r.json()).then((c) => { categories = c; render(); });

  // ---------- rendering ----------

  function render() {
    renderTopbar();
    if (!state) {
      $app.innerHTML = resuming ? `<p class="center muted">Reconnecting…</p>` : homeView();
    } else {
      const views = { lobby: lobbyView, writing: writingView, voting: votingView, results: resultsView, final: finalView };
      const focused = document.activeElement?.id;
      const caret = document.activeElement?.selectionStart;
      $app.innerHTML = (socket.connected ? '' : `<div class="conn">Reconnecting…</div>`) + views[state.phase]();
      // Restore focus so typing isn't interrupted when someone else submits.
      if (focused) {
        const el = document.getElementById(focused);
        if (el) { el.focus(); if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret); }
      }
    }
  }

  function renderTopbar() {
    if (!state) { $topRight.innerHTML = ''; return; }
    $topRight.innerHTML = `
      <button class="small-btn secondary" data-action="invite">📲 Invite</button>`;
  }

  function homeView() {
    const joining = !!urlRoom;
    const cats = categoryPicker(ui.categories);
    if (joining) {
      return `
        <div class="card">
          <h1>Join game <span style="color:var(--a)">${esc(urlRoom)}</span></h1>
          <p class="muted">What should everyone call you?</p>
          <label for="name">Your name</label>
          <input id="name" maxlength="20" autocomplete="nickname" value="${esc(ui.name)}" placeholder="e.g. Grandma Jo" />
          <button data-action="join" ${ui.busy ? 'disabled' : ''}>Join the game</button>
        </div>
        <p class="center"><button class="link" data-action="go-home">Start a different game instead</button></p>`;
    }
    return `
      <div class="card">
        <h1>Two worlds. One line.</h1>
        <p class="muted">Each round you get two random franchises. Write a line of dialogue from their crossover. Everyone ranks the answers anonymously. Best lines win!</p>
      </div>
      <div class="card">
        <h2>Host a new game</h2>
        <label for="name">Your name</label>
        <input id="name" maxlength="20" autocomplete="nickname" value="${esc(ui.name)}" placeholder="e.g. Dad" />
        <label>Pick categories <span class="muted small">(one or more)</span></label>
        ${cats}
        ${ui.categories.includes('custom') ? `<p class="small muted">✏️ You’ll type in your custom items on the next screen.</p>` : ''}
        <label>Rounds</label>
        ${roundsStepper(ui.rounds)}
        <button data-action="create" ${ui.busy ? 'disabled' : ''}>Create game</button>
      </div>
      <div class="card">
        <h2>Join a game</h2>
        <label for="code">Game code</label>
        <input id="code" class="code" maxlength="4" autocomplete="off" autocapitalize="characters" value="${esc(ui.code)}" placeholder="ABCD" />
        <button class="secondary" data-action="enter-code">Next</button>
      </div>`;
  }

  function categoryPicker(selected) {
    if (!categories.length) return `<p class="muted">Loading…</p>`;
    return `<div class="cats">${categories.map((c) => `
      <button class="cat ${selected.includes(c.id) ? 'selected' : ''}" aria-pressed="${selected.includes(c.id)}" data-action="pick-cat" data-cat="${c.id}">
        <span class="emoji">${c.emoji}</span>${esc(c.label)}
      </button>`).join('')}</div>`;
  }

  const MIN_ROUNDS = 1;
  const MAX_ROUNDS = 7;

  function roundsStepper(n) {
    return `
      <div class="stepper">
        <button class="step" data-action="rounds" data-delta="-1" aria-label="Fewer rounds" ${n <= MIN_ROUNDS ? 'disabled' : ''}>◀</button>
        <div class="step-value" aria-live="polite"><b>${n}</b> ${n === 1 ? 'round' : 'rounds'}</div>
        <button class="step" data-action="rounds" data-delta="1" aria-label="More rounds" ${n >= MAX_ROUNDS ? 'disabled' : ''}>▶</button>
      </div>`;
  }

  function customEditor() {
    const items = state.customItems || [];
    const short = Math.max(0, state.minCustomItems - items.length);
    return `
      <div class="custom-box">
        <label for="custom-input">✏️ Your custom items
          <span class="count ${short ? '' : 'ok'}">${items.length}${short ? ` / ${state.minCustomItems} needed` : ' ✓'}</span>
        </label>
        <div class="add-row">
          <input id="custom-input" maxlength="60" autocomplete="off" value="${esc(ui.customDraft)}" placeholder="e.g. Grandpa’s boat" />
          <button class="small-btn secondary" data-action="custom-add">Add</button>
        </div>
        <p class="small" style="color:var(--muted);margin:6px 0 0">Tip: paste a list with one item per line to add them all at once.</p>
        ${items.length ? `<ul class="custom-list">${items.map((it, i) => `
          <li>${esc(it)}<button class="x" data-action="custom-remove" data-index="${i}" aria-label="Remove ${esc(it)}">✕</button></li>`).join('')}</ul>` : ''}
      </div>`;
  }

  function addCustomItems(newItems) {
    newItems = newItems.map((t) => t.trim()).filter(Boolean);
    if (!newItems.length) return;
    const existing = state.customItems || [];
    const lower = new Set(existing.map((t) => t.toLowerCase()));
    const fresh = newItems.filter((t) => !lower.has(t.toLowerCase()));
    if (!fresh.length) return toast('That’s already on the list.');
    send('setCustomItems', { items: [...existing, ...fresh] });
  }

  function playerChips({ showWaiting = false, kick = false } = {}) {
    return `<ul class="players">${state.players.map((p) => `
      <li class="${p.connected ? '' : 'offline'} ${showWaiting && p.waiting ? 'waiting' : ''}">
        ${esc(p.name)}
        ${p.name === state.adminName ? '<span class="tag">HOST</span>' : ''}
        ${kick && p.id !== state.me.id ? `<button class="x" data-action="kick" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
      </li>`).join('')}</ul>`;
  }

  function scoreTable() {
    return `<table class="scores">${state.players.map((p, i) => `
      <tr class="${p.id === state.me.id ? 'me' : ''}">
        <td>${i + 1}. ${esc(p.name)}${p.connected ? '' : ' <span class="muted small">(away)</span>'}</td>
        <td>${p.score}</td>
      </tr>`).join('')}</table>`;
  }

  function promptCard(compact = false) {
    const { a, b } = state.prompt;
    return `
      <div class="card prompt ${compact ? 'compact' : ''}">
        <div class="ip a">${esc(a)}</div>
        <div class="x">✖</div>
        <div class="ip b">${esc(b)}</div>
        ${compact ? '' : `<div class="ask">Write a line of dialogue from this crossover!</div>`}
      </div>`;
  }

  function roundPill() {
    return `<div class="round-pill">Round ${state.round} of ${state.totalRounds} · ${esc(catLabel(state.categories))}</div>`;
  }

  function lobbyView() {
    const enough = state.players.filter((p) => p.connected).length >= state.minPlayers;
    const usesCustom = state.categories.includes('custom');
    const customShort = usesCustom ? Math.max(0, state.minCustomItems - state.customCount) : 0;
    const canStart = enough && customShort === 0;
    const startLabel = !enough
      ? `Waiting for at least ${state.minPlayers} players…`
      : customShort
        ? `Add ${customShort} more custom item${customShort === 1 ? '' : 's'}`
        : 'Everyone’s in — start!';
    if (state.isAdmin) {
      return `
        <div class="card center">
          <p class="muted" style="margin-top:0">Have everyone scan to join, or go to the link and enter code</p>
          <div class="room-code">${esc(state.code)}</div>
          <div class="qr" id="qr-slot">${qrCache[state.code]?.svg || '…'}</div>
          <p class="join-url" id="url-slot">${esc(qrCache[state.code]?.url || '')}</p>
        </div>
        <div class="card">
          <h2>Players (${state.players.length})</h2>
          ${playerChips({ kick: true })}
          <label>Categories <span class="small" style="color:var(--muted)">(tap to mix)</span></label>
          ${categoryPicker(state.categories)}
          ${usesCustom ? customEditor() : ''}
          <label>Rounds</label>
          ${roundsStepper(state.totalRounds)}
          <button data-action="start" ${canStart ? '' : 'disabled'}>
            ${startLabel}
          </button>
        </div>`;
    }
    return `
      <div class="card waiting-box">
        <div class="big">🍿</div>
        <h2>You’re in, ${esc(state.me.name)}!</h2>
        <p class="muted">${state.categories.length > 1 ? 'Categories' : 'Category'}: <b>${esc(catLabel(state.categories))}</b><br/>Rounds: <b>${state.totalRounds}</b><br/>Waiting for ${esc(state.adminName)} to start the game…</p>
      </div>
      <div class="card">
        <h2>Players (${state.players.length})</h2>
        ${playerChips()}
      </div>
      <p class="center"><button class="link" data-action="leave">Leave game</button></p>`;
  }

  function waitingOn() {
    const w = state.players.filter((p) => p.waiting);
    if (!w.length) return '';
    return `<p class="muted small center">Waiting on: ${w.map((p) => esc(p.name)).join(', ')}</p>`;
  }

  function adminSkip(label) {
    if (!state.isAdmin) return '';
    return `<button class="ghost" data-action="skip">${label}</button>`;
  }

  function writingView() {
    const key = `${state.code}-${state.round}-${state.rerolls}`;
    if (ui.draftKey !== key) { ui.draftKey = key; ui.draft = ''; }
    if (state.myAnswer) {
      return `
        ${roundPill()}
        ${promptCard(true)}
        <div class="card waiting-box">
          <div class="big">✅</div>
          <h2>Answer locked in!</h2>
          <p class="muted"><i>“${esc(state.myAnswer)}”</i></p>
          ${playerChips({ showWaiting: true })}
        </div>
        ${waitingOn()}
        ${adminSkip('Stop waiting — go to voting')}
        ${rerollButton()}`;
    }
    return `
      ${roundPill()}
      ${promptCard()}
      <div class="card">
        <textarea id="answer" maxlength="200" placeholder="&quot;Type the line here…&quot;">${esc(ui.draft)}</textarea>
        <div class="counter"><span id="count">${ui.draft.length}</span>/200</div>
        <button data-action="answer">Submit answer</button>
      </div>
      ${waitingOn()}
      ${adminSkip('Stop waiting — go to voting')}
      ${rerollButton()}`;
  }

  function rerollButton() {
    if (!state.isAdmin) return '';
    return `<button class="ghost" data-action="reroll">🎲 Re-roll this pairing</button>`;
  }

  function showRerollConfirm() {
    const { a, b } = state.prompt;
    const answered = state.submittedCount || 0;
    $modal.innerHTML = `
      <div class="card">
        <div style="font-size:2.6rem">🎲</div>
        <h2>Re-roll this pairing?</h2>
        <p class="muted"><b>${esc(a)}</b> ✖ <b>${esc(b)}</b> will be swapped for a new pair.
          ${answered
            ? `The ${answered} ${answered === 1 ? 'answer' : 'answers'} already submitted will be <b>cleared</b> so everyone can write a new one.`
            : 'Nobody has submitted an answer yet.'}</p>
        <button data-action="reroll-confirm">Yes, re-roll</button>
        <button class="secondary" data-action="close-modal">Cancel</button>
      </div>`;
    $modal.dataset.kind = 'reroll';
    $modal.classList.remove('hidden');
  }

  function closeModal() {
    $modal.classList.add('hidden');
    delete $modal.dataset.kind;
  }

  function votingView() {
    const key = `${state.code}-${state.round}`;
    if (ui.rankingKey !== key) { ui.rankingKey = key; ui.ranking = []; }
    const ballotIds = state.ballot.map((a) => a.id);
    ui.ranking = ui.ranking.filter((id) => ballotIds.includes(id));

    if (state.hasVoted || state.ballot.length === 0) {
      return `
        ${roundPill()}
        ${promptCard(true)}
        <div class="card waiting-box">
          <div class="big">${state.hasVoted ? '🗳️' : '🙈'}</div>
          <h2>${state.hasVoted ? 'Rankings in!' : 'Nothing for you to rank'}</h2>
          <p class="muted">${state.hasVoted ? 'Waiting for everyone else…' : 'Your answer is the only one — sit tight.'}</p>
          ${playerChips({ showWaiting: true })}
        </div>
        ${waitingOn()}
        ${adminSkip('Stop waiting — show results')}`;
    }

    const done = ui.ranking.length === state.ballot.length;
    return `
      ${roundPill()}
      ${promptCard(true)}
      <h2>Rank the lines</h2>
      <p class="muted small">Tap your favourite first, then your next favourite, and so on. Tap again to undo.${state.myAnswer ? ' (Your own line is hidden.)' : ''}</p>
      ${state.ballot.map((a) => {
        const r = ui.ranking.indexOf(a.id) + 1;
        return `<button class="answer ${r ? `ranked r${r}` : ''}" data-action="rank" data-id="${a.id}">
          <span class="rank">${r || ''}</span>“${esc(a.text)}”</button>`;
      }).join('')}
      <button data-action="vote" ${done ? '' : 'disabled'}>${done ? 'Lock in my ranking' : `Ranked ${ui.ranking.length} of ${state.ballot.length}`}</button>
      ${ui.ranking.length ? `<button class="link" data-action="reset-rank">Start over</button>` : ''}
      ${waitingOn()}
      ${adminSkip('Stop waiting — show results')}`;
  }

  function resultsView() {
    const results = state.results || [];
    const top = results[0]?.points;
    return `
      ${roundPill()}
      ${promptCard(true)}
      <h2>Round ${state.round} results</h2>
      ${results.length === 0 ? '<p class="muted">Nobody answered this round!</p>' : ''}
      ${results.map((r) => `
        <div class="card result ${r.points === top && top > 0 ? 'top' : ''} ${r.mine ? 'mine' : ''}">
          <div class="quote">“${esc(r.text)}”</div>
          <div class="meta">
            <span class="who">— ${esc(r.author)}${r.mine ? ' (you)' : ''}${r.firsts ? ` · ${'⭐'.repeat(Math.min(r.firsts, 5))}` : ''}</span>
            <span class="pts">+${r.points}</span>
          </div>
        </div>`).join('')}
      <div class="card">
        <h2>Scoreboard</h2>
        ${scoreTable()}
      </div>
      ${state.isAdmin
        ? `<button data-action="next">${state.isLastRound ? '🏆 Reveal the winner' : 'Next round →'}</button>`
        : `<p class="center muted">Waiting for ${esc(state.adminName)} to continue…</p>`}`;
  }

  function finalView() {
    const w = state.winners;
    return `
      <div class="card winner">
        <div class="trophy">🏆</div>
        <p class="muted" style="margin:0">${w.length > 1 ? "It's a tie!" : 'The winner is'}</p>
        <div class="name">${w.map(esc).join(' & ')}</div>
      </div>
      <div class="card">
        <h2>Final scores</h2>
        ${scoreTable()}
      </div>
      ${state.isAdmin
        ? `<button data-action="new-game">Play again (new categories or rounds)</button>`
        : `<p class="center muted">Waiting for ${esc(state.adminName)} to start a new game…</p>`}
      <p class="center"><button class="link" data-action="leave">Leave game</button></p>`;
  }

  // ---------- invite / QR ----------

  const qrCache = {};
  async function loadQr(code) {
    if (qrCache[code]) return qrCache[code];
    const res = await fetch(`/api/join/${code}`);
    if (!res.ok) return null;
    qrCache[code] = await res.json();
    return qrCache[code];
  }

  async function showInvite() {
    const info = await loadQr(state.code);
    $modal.innerHTML = `
      <div class="card">
        <h2>Join the game!</h2>
        <div class="qr">${info?.svg || ''}</div>
        <p class="join-url">${esc(info?.url || '')}</p>
        <div class="room-code">${esc(state.code)}</div>
        <button class="secondary" data-action="close-modal">Done</button>
      </div>`;
    $modal.classList.remove('hidden');
  }

  // Fill the lobby QR once we have it.
  const observer = new MutationObserver(() => {
    const slot = document.getElementById('qr-slot');
    if (slot && slot.textContent === '…' && state) {
      loadQr(state.code).then((info) => {
        if (!info) return;
        const s = document.getElementById('qr-slot');
        const u = document.getElementById('url-slot');
        if (s) s.innerHTML = info.svg;
        if (u) u.textContent = info.url;
      });
    }
  });
  observer.observe($app, { childList: true });

  // ---------- events ----------

  document.addEventListener('input', (e) => {
    if (e.target.id === 'name') ui.name = e.target.value;
    if (e.target.id === 'code') ui.code = e.target.value.toUpperCase();
    if (e.target.id === 'custom-input') ui.customDraft = e.target.value;
    if (e.target.id === 'answer') {
      ui.draft = e.target.value;
      const c = document.getElementById('count');
      if (c) c.textContent = ui.draft.length;
    }
  });

  // Pasting several lines into the custom box adds each line as an item.
  document.addEventListener('paste', (e) => {
    if (e.target.id !== 'custom-input') return;
    const text = e.clipboardData?.getData('text') || '';
    const lines = text.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    addCustomItems(lines);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'answer' && !e.shiftKey) { e.preventDefault(); click('answer'); }
    if (e.target.id === 'code') click('enter-code');
    if (e.target.id === 'name') click(urlRoom ? 'join' : 'create');
    if (e.target.id === 'custom-input') { e.preventDefault(); click('custom-add'); }
  });

  function click(action) {
    document.querySelector(`[data-action="${action}"]`)?.click();
  }

  function rememberName() {
    try { localStorage.setItem('crossover-name', ui.name.trim()); } catch {}
  }

  async function withBusy(fn) {
    if (ui.busy) return;
    ui.busy = true;
    try { await fn(); } finally { ui.busy = false; render(); }
  }

  const actions = {
    rounds: (el) => {
      const current = state ? state.totalRounds : ui.rounds;
      const n = Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, current + Number(el.dataset.delta)));
      if (n === current) return;
      if (state) send('setRounds', { rounds: n });
      else { ui.rounds = n; render(); }
    },
    'custom-add': () => {
      if (!ui.customDraft.trim()) return;
      addCustomItems([ui.customDraft]);
      ui.customDraft = '';
      const input = document.getElementById('custom-input');
      if (input) { input.value = ''; input.focus(); }
    },
    'custom-remove': (el) => {
      const items = [...(state.customItems || [])];
      items.splice(Number(el.dataset.index), 1);
      send('setCustomItems', { items });
    },
    'pick-cat': (el) => {
      const cat = el.dataset.cat;
      if (state) send('setCategories', { categories: toggleCategory(state.categories, cat) });
      else { ui.categories = toggleCategory(ui.categories, cat); render(); }
    },
    create: () => withBusy(async () => {
      if (!ui.name.trim()) return toast('Enter your name first.');
      rememberName();
      const res = await send('create', { name: ui.name, categories: ui.categories, rounds: ui.rounds });
      if (res.ok) {
        saveSession({ code: res.code, playerId: res.playerId });
        history.replaceState(null, '', `/?room=${res.code}`);
      }
    }),
    'enter-code': () => {
      const code = ui.code.trim().toUpperCase();
      if (code.length !== 4) return toast('Game codes are 4 letters.');
      location.href = `/?room=${code}`;
    },
    join: () => withBusy(async () => {
      if (!ui.name.trim()) return toast('Enter your name first.');
      rememberName();
      const res = await send('join', { code: urlRoom, name: ui.name });
      if (res.ok) saveSession({ code: res.code, playerId: res.playerId });
    }),
    'go-home': () => { location.href = '/'; },
    invite: () => showInvite(),
    'close-modal': () => closeModal(),
    reroll: () => showRerollConfirm(),
    'reroll-confirm': async () => {
      const res = await send('reroll');
      closeModal();
      if (res.ok) toast('🎲 New pairing! Answers have been cleared.');
    },
    start: () => send('start'),
    kick: (el) => {
      const p = state.players.find((p) => p.id === el.dataset.id);
      if (p && confirm(`Remove ${p.name} from the game?`)) send('kick', { playerId: p.id });
    },
    answer: () => withBusy(async () => {
      if (!ui.draft.trim()) return toast('Write something first!');
      await send('answer', { text: ui.draft });
    }),
    rank: (el) => {
      const id = el.dataset.id;
      const i = ui.ranking.indexOf(id);
      if (i >= 0) ui.ranking.splice(i, 1);
      else ui.ranking.push(id);
      render();
    },
    'reset-rank': () => { ui.ranking = []; render(); },
    vote: () => withBusy(() => send('vote', { ranking: ui.ranking })),
    skip: () => { if (confirm('Move on without the players who haven’t finished?')) send('skip'); },
    next: () => send('next'),
    'new-game': () => send('newGame'),
    leave: async () => {
      if (!confirm('Leave this game?')) return;
      await send('leave');
      saveSession(null);
      state = null;
      location.href = '/';
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) {
      if (e.target === $modal) closeModal();
      return;
    }
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el); }
  });

  render();
})();
