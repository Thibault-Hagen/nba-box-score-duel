// Box Score Duel — reads data/season.json (written by the GitHub Action) and renders
// the nightly leaderboard plus a head-to-head comparison of any two players.
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmtDate = (d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) =>
    new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

  const S = { data: null, night: null, game: null, showAll: false, a: null, b: null, scope: 'night', trend: 'gs' };
  let byPlayer = new Map();
  let nights = [];

  // ---------- data ----------
  function build(raw) {
    const F = raw.fields;
    const ix = Object.fromEntries(F.map((f, i) => [f, i]));
    byPlayer = new Map();
    const lines = raw.lines.map((r) => {
      const l = {};
      for (const f of F) l[f] = r[ix[f]];
      const g = raw.games[l.g];
      l.d = g.d;
      l.home = g.h === l.tm;
      const my = l.home ? g.hs : g.as, their = l.home ? g.as : g.hs;
      l.res = my > their ? 'W' : 'L';
      l.score = `${my}-${their}`;
      l.gs = l.pts + 0.4 * l.fgm - 0.7 * l.fga - 0.4 * (l.fta - l.ftm) + 0.7 * l.oreb + 0.3 * l.dreb + l.stl + 0.7 * l.ast + 0.7 * l.blk - 0.4 * l.pf - l.tov;
      const tsa = 2 * (l.fga + 0.44 * l.fta);
      l.ts = tsa ? (l.pts / tsa) * 100 : null;
      if (!byPlayer.has(l.p)) byPlayer.set(l.p, []);
      byPlayer.get(l.p).push(l);
      return l;
    });
    for (const arr of byPlayer.values()) arr.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
    nights = [...new Set(Object.values(raw.games).map((g) => g.d))].sort().reverse();
    return { ...raw, rows: lines };
  }

  const player = (id) => S.data.players[id] || { n: 'Unknown', tm: '', pos: '' };
  const nightLines = () => S.data.rows.filter((l) => l.d === S.night && (!S.game || l.g === S.game));
  const through = (id) => (byPlayer.get(id) || []).filter((l) => l.d <= S.night);

  function scoped(id) {
    const all = through(id);
    if (S.scope === 'night') return all.filter((l) => l.d === S.night);
    if (S.scope === 'last5') return all.slice(-5);
    return all;
  }

  function agg(lines) {
    if (!lines.length) return null;
    const n = lines.length;
    const t = {};
    for (const k of ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'pm', 'gs', 'oreb', 'dreb'])
      t[k] = lines.reduce((s, l) => s + l[k], 0);
    const avg = (k) => t[k] / n;
    const pct = (m, a) => (a ? (m / a) * 100 : null);
    const tsa = 2 * (t.fga + 0.44 * t.fta);
    return {
      n, t,
      min: avg('min'), pts: avg('pts'), reb: avg('reb'), ast: avg('ast'), stl: avg('stl'), blk: avg('blk'),
      tov: avg('tov'), pm: avg('pm'), gs: avg('gs'),
      fg: pct(t.fgm, t.fga), tp: pct(t.tpm, t.tpa), ft: pct(t.ftm, t.fta), ts: tsa ? (t.pts / tsa) * 100 : null,
    };
  }

  // ---------- URL state ----------
  function readURL() {
    const q = new URLSearchParams(location.search);
    if (q.get('d') && nights.includes(q.get('d'))) S.night = q.get('d');
    if (q.get('a') && byPlayer.has(q.get('a'))) S.a = q.get('a');
    if (q.get('b') && byPlayer.has(q.get('b'))) S.b = q.get('b');
    if (['night', 'last5', 'season'].includes(q.get('s'))) S.scope = q.get('s');
  }
  function writeURL() {
    const q = new URLSearchParams();
    if (S.night) q.set('d', S.night);
    if (S.a) q.set('a', S.a);
    if (S.b) q.set('b', S.b);
    q.set('s', S.scope);
    history.replaceState(null, '', '?' + q.toString());
  }

  // ---------- render: status, dates, games, board ----------
  function ago(iso) {
    if (!iso) return 'never';
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hr ago`;
    return fmtDate(iso.slice(0, 10));
  }

  function renderStatus() {
    const n = Object.keys(S.data.games).length;
    $('#status').textContent = `${n} games, ${byPlayer.size} players · updated ${ago(S.data.updated)}`;
  }

  function renderDates() {
    const el = $('#dates');
    el.innerHTML = nights.map((d) =>
      `<button type="button" role="tab" data-d="${d}" aria-selected="${d === S.night}">${esc(fmtDate(d))}</button>`).join('');
    el.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderGames() {
    const games = Object.entries(S.data.games).filter(([, g]) => g.d === S.night);
    $('#games').innerHTML = games.map(([id, g]) => {
      const awayWin = g.as > g.hs;
      return `<button type="button" class="game" data-g="${id}" aria-pressed="${S.game === id}">
        <span class="row ${awayWin ? '' : 'lose'}"><span>${esc(g.a)}</span><span>${g.as}</span></span>
        <span class="row ${awayWin ? 'lose' : ''}"><span>@ ${esc(g.h)}</span><span>${g.hs}</span></span>
        <span class="tag">${g.t === 3 ? 'Playoffs' : 'Final'}</span></button>`;
    }).join('');
  }

  const head = (id, cls = 'head') =>
    `<img class="${cls}" src="${esc(player(id).hs)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;

  function renderBoard() {
    const rows = nightLines().sort((x, y) => y.gs - x.gs);
    const shown = S.showAll ? rows : rows.slice(0, 12);
    $('#board tbody').innerHTML = shown.map((l, i) => {
      const p = player(l.p);
      return `<tr>
        <td class="rk">${i + 1}</td>
        <td class="pl">${head(l.p)}<span>${esc(p.n)}<br><small>${esc(l.tm)} ${l.home ? 'vs' : '@'} ${esc(l.opp)} · ${l.min} min</small></span></td>
        <td class="gs">${l.gs.toFixed(1)}</td>
        <td>${l.pts}</td><td>${l.reb}</td><td>${l.ast}</td>
        <td class="hide-sm">${l.fgm}-${l.fga}</td><td class="hide-sm">${l.tpm}-${l.tpa}</td>
        <td class="hide-sm">${l.pm > 0 ? '+' : ''}${l.pm}</td>
        <td class="act"><span class="pick">
          <button type="button" class="a ${S.a === l.p ? 'on' : ''}" data-set="a" data-p="${l.p}" aria-label="Set ${esc(p.n)} as player A">A</button>
          <button type="button" class="b ${S.b === l.p ? 'on' : ''}" data-set="b" data-p="${l.p}" aria-label="Set ${esc(p.n)} as player B">B</button>
        </span></td></tr>`;
    }).join('');
    const more = $('#more');
    more.hidden = rows.length <= 12;
    more.textContent = S.showAll ? 'Show top 12' : `Show all ${rows.length} players`;
  }

  // ---------- render: duel ----------
  function renderSlot(slot) {
    const el = $(`.slot[data-slot="${slot}"]`);
    const id = S[slot];
    const keep = el.querySelector('input');
    const typed = keep && document.activeElement === keep ? keep.value : '';
    let who = `<p class="note">Pick a player.</p>`;
    if (id) {
      const p = player(id);
      const lines = through(id);
      const played = lines.some((l) => l.d === S.night);
      who = `<div class="who">${head(id)}<div><div class="name">${esc(p.n)}</div>
        <div class="meta">${esc(p.tm)}${p.pos ? ' · ' + esc(p.pos) : ''} · ${lines.length} game${lines.length === 1 ? '' : 's'}${
          S.scope === 'night' && !played ? ' · did not play ' + esc(fmtDate(S.night, { month: 'short', day: 'numeric' })) : ''}</div></div></div>`;
    }
    el.innerHTML = `${who}<div class="search">
      <label class="sr" for="q-${slot}">Find player ${slot.toUpperCase()}</label>
      <input id="q-${slot}" type="search" autocomplete="off" placeholder="Search any player" value="${esc(typed)}">
      <ul class="results" hidden></ul></div>`;
    if (typed) { const i = el.querySelector('input'); i.focus(); showResults(slot, i.value); }
  }

  const ROWS = [
    { k: 'gs', label: 'Game Score', key: true, dec: 1 },
    { k: 'pts', label: 'Points', dec: 1 },
    { k: 'reb', label: 'Rebounds', dec: 1 },
    { k: 'ast', label: 'Assists', dec: 1 },
    { k: 'stl', label: 'Steals', dec: 1 },
    { k: 'blk', label: 'Blocks', dec: 1 },
    { k: 'tov', label: 'Turnovers', dec: 1, low: true },
    { k: 'ts', label: 'True shooting', pct: true },
    { k: 'fg', label: 'FG', pct: true, made: ['fgm', 'fga'] },
    { k: 'tp', label: '3PT', pct: true, made: ['tpm', 'tpa'] },
    { k: 'ft', label: 'FT', pct: true, made: ['ftm', 'fta'] },
    { k: 'pm', label: '+/-', dec: 1, sign: true },
    { k: 'min', label: 'Minutes', dec: 1, neutral: true },
  ];

  function show(row, s) {
    if (!s) return '—';
    const v = s[row.k];
    if (v == null) return '—';
    const single = s.n === 1;
    if (row.made && single) return `${s.t[row.made[0]]}/${s.t[row.made[1]]}`;
    if (row.pct) return v.toFixed(1);
    const txt = single ? (row.k === 'gs' ? v.toFixed(1) : String(Math.round(v))) : v.toFixed(row.dec);
    return row.sign && v > 0 ? '+' + txt : txt;
  }

  function renderCompare() {
    const el = $('#compare');
    if (!S.a || !S.b) { el.innerHTML = `<p class="note">Choose two players with the A and B buttons, or search above.</p>`; return; }
    const A = agg(scoped(S.a)), B = agg(scoped(S.b));
    if (!A && !B) { el.innerHTML = `<p class="note">Neither player has a game in this range. Try “Season”.</p>`; return; }
    let wa = 0, wb = 0;
    const html = ROWS.map((r) => {
      const va = A?.[r.k], vb = B?.[r.k];
      let win = null;
      if (!r.neutral && va != null && vb != null && va !== vb) {
        win = (r.low ? va < vb : va > vb) ? 'a' : 'b';
        win === 'a' ? wa++ : wb++;
      }
      const max = Math.max(Math.abs(va ?? 0), Math.abs(vb ?? 0)) || 1;
      const w = (v) => (v == null ? 0 : Math.max(2, (Math.abs(v) / max) * 100));
      return `<div class="crow ${r.key ? 'key' : ''}">
        <div class="bar a"><i style="width:${w(va)}%"></i></div>
        <div class="val a ${win === 'a' ? 'win' : win ? 'lose' : ''}">${show(r, A)}</div>
        <div class="lbl">${r.label}${r.pct && !(r.made && A?.n === 1) ? ' %' : ''}</div>
        <div class="val b ${win === 'b' ? 'win' : win ? 'lose' : ''}">${show(r, B)}</div>
        <div class="bar b"><i style="width:${w(vb)}%"></i></div></div>`;
    }).join('');
    const scopeTxt = S.scope === 'night' ? `on ${fmtDate(S.night)}` : S.scope === 'last5' ? 'over each player’s last 5 games' : `this season through ${fmtDate(S.night, { month: 'short', day: 'numeric' })}`;
    const avgTxt = S.scope === 'night' ? '' : ' Counting stats are per-game averages; shooting is from season totals.';
    el.innerHTML = html + `<p class="tally">Brighter number = better.<br><b style="color:var(--a)">${esc(player(S.a).n)}</b> wins ${wa} · <b style="color:var(--b)">${esc(player(S.b).n)}</b> wins ${wb} ${esc(scopeTxt)}.${avgTxt}</p>`;
  }

  function niceStep(range) {
    const raw = range / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  function renderChart() {
    const el = $('#chart');
    const ids = [S.a, S.b].filter(Boolean);
    if (!ids.length) { el.innerHTML = ''; return; }
    const k = S.trend;
    const series = ids.map((id) => through(id).filter((l) => l[k] != null));
    const dates = [...new Set(series.flat().map((l) => l.d))].sort();
    if (!dates.length) { el.innerHTML = `<p class="note">No games yet.</p>`; return; }
    const vals = series.flat().map((l) => l[k]);
    let lo = Math.min(0, ...vals), hi = Math.max(...vals, 1);
    const step = niceStep(hi - lo);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const W = Math.max(320, Math.min(900, el.clientWidth || 640)), H = W < 500 ? 200 : 240, L = 36, R = 14, T = 12, Bm = 26;
    const x = (d) => L + (dates.length === 1 ? (W - L - R) / 2 : (dates.indexOf(d) / (dates.length - 1)) * (W - L - R));
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - Bm);
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += step) {
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--soft)" stroke-width="1"/>`;
      g += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>`;
    }
    if (lo < 0) g += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)" stroke-width="1.5"/>`;
    const tickEvery = Math.max(1, Math.ceil(dates.length / 6));
    dates.forEach((d, i) => {
      if (i % tickEvery === 0 || i === dates.length - 1)
        g += `<text x="${x(d)}" y="${H - 6}" text-anchor="${dates.length > 1 && i === dates.length - 1 ? 'end' : i === 0 && dates.length > 1 ? 'start' : 'middle'}">${esc(fmtDate(d, { month: 'short', day: 'numeric' }))}</text>`;
    });
    if (dates.includes(S.night)) g += `<line x1="${x(S.night)}" x2="${x(S.night)}" y1="${T}" y2="${H - Bm}" stroke="var(--muted)" stroke-dasharray="3 3" stroke-width="1"/>`;
    const colors = ['var(--a)', 'var(--b)'];
    series.forEach((ls, si) => {
      const c = colors[ids[si] === S.a ? 0 : 1];
      if (ls.length > 1) g += `<polyline fill="none" stroke="${c}" stroke-width="2.25" stroke-linejoin="round" points="${ls.map((l) => `${x(l.d)},${y(l[k])}`).join(' ')}"/>`;
      ls.forEach((l, i) => {
        const last = i === ls.length - 1;
        g += `<circle cx="${x(l.d)}" cy="${y(l[k])}" r="${last ? 4.5 : 3}" fill="${last ? c : 'var(--surface)'}" stroke="${c}" stroke-width="2"><title>${esc(player(l.p).n)} · ${esc(fmtDate(l.d))} ${l.home ? 'vs' : '@'} ${esc(l.opp)}: ${+l[k].toFixed(1)}</title></circle>`;
      });
    });
    const name = $('#trendStat').selectedOptions[0].textContent;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} by game">${g}</svg>
      <div class="legend">${ids.map((id) => `<span style="--c:${id === S.a ? 'var(--a)' : 'var(--b)'}">${esc(player(id).n)}</span>`).join('')}</div>`;
  }

  function renderLogs() {
    $('#logs').innerHTML = ['a', 'b'].filter((s) => S[s]).map((s) => {
      const id = S[s];
      const rows = through(id).slice(-10).reverse();
      return `<div class="log" style="--c:var(--${s});--cs:var(--${s}-soft)"><h3>${esc(player(id).n)} · last ${rows.length}</h3>
        <div class="log-scroll"><table><thead><tr><th>Game</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3PT</th><th>+/-</th><th>GmSc</th></tr></thead><tbody>
        ${rows.map((l) => `<tr class="${l.d === S.night ? 'sel' : ''}"><td>${esc(fmtDate(l.d, { month: 'numeric', day: 'numeric' }))} ${l.home ? 'vs' : '@'} ${esc(l.opp)} <small>${l.res} ${l.score}</small></td>
          <td>${l.min}</td><td>${l.pts}</td><td>${l.reb}</td><td>${l.ast}</td><td>${l.fgm}-${l.fga}</td><td>${l.tpm}-${l.tpa}</td><td>${l.pm > 0 ? '+' : ''}${l.pm}</td><td>${l.gs.toFixed(1)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    }).join('');
  }

  function renderScope() {
    document.querySelectorAll('#scope button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.scope === S.scope)));
  }

  function renderDuel() {
    renderScope();
    renderSlot('a'); renderSlot('b');
    renderCompare(); renderChart(); renderLogs();
  }

  function renderAll() {
    renderStatus(); renderDates(); renderGames(); renderBoard(); renderDuel();
    writeURL();
  }

  // ---------- search ----------
  let searchIndex = [];
  function indexPlayers() {
    searchIndex = [...byPlayer.keys()].map((id) => ({ id, key: norm(player(id).n), gp: byPlayer.get(id).length }));
  }
  function showResults(slot, q) {
    const ul = $(`.slot[data-slot="${slot}"] .results`);
    const t = norm(q.trim());
    if (!t) { ul.hidden = true; return; }
    const hits = searchIndex.filter((p) => p.key.includes(t))
      .sort((x, y) => (y.key.startsWith(t) - x.key.startsWith(t)) || y.gp - x.gp).slice(0, 8);
    ul.innerHTML = hits.length
      ? hits.map((h, i) => `<li><button type="button" class="${i === 0 ? 'hl' : ''}" data-set="${slot}" data-p="${h.id}"><span>${esc(player(h.id).n)}</span><small>${esc(player(h.id).tm)} · ${h.gp} GP</small></button></li>`).join('')
      : `<li class="note" style="padding:6px 8px">No player matches “${esc(q)}”.</li>`;
    ul.hidden = false;
  }

  // ---------- events ----------
  function setPlayer(slot, id) {
    const other = slot === 'a' ? 'b' : 'a';
    if (S[other] === id) S[other] = S[slot];
    S[slot] = id;
    renderBoard(); renderDuel(); writeURL();
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) {
      document.querySelectorAll('.results').forEach((u) => { if (!u.parentElement.contains(e.target)) u.hidden = true; });
      return;
    }
    if (t.dataset.d) { S.night = t.dataset.d; S.game = null; S.showAll = false; renderAll(); }
    else if (t.dataset.g) { S.game = S.game === t.dataset.g ? null : t.dataset.g; renderGames(); renderBoard(); }
    else if (t.dataset.set) setPlayer(t.dataset.set, t.dataset.p);
    else if (t.dataset.scope) { S.scope = t.dataset.scope; renderDuel(); writeURL(); }
    else if (t.id === 'more') { S.showAll = !S.showAll; renderBoard(); }
  });

  document.addEventListener('input', (e) => {
    const slot = e.target.closest('.slot')?.dataset.slot;
    if (slot && e.target.matches('input')) showResults(slot, e.target.value);
  });

  document.addEventListener('keydown', (e) => {
    const slot = e.target.closest?.('.slot')?.dataset.slot;
    if (!slot || !e.target.matches('input')) return;
    const btns = [...document.querySelectorAll(`.slot[data-slot="${slot}"] .results button`)];
    if (!btns.length) return;
    let i = btns.findIndex((b) => b.classList.contains('hl'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      btns[i]?.classList.remove('hl');
      i = (i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
      btns[i].classList.add('hl');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setPlayer(slot, btns[Math.max(0, i)].dataset.p);
    } else if (e.key === 'Escape') {
      e.target.value = ''; showResults(slot, '');
    }
  });

  $('#trendStat').addEventListener('change', (e) => { S.trend = e.target.value; renderChart(); });

  // ---------- boot ----------
  async function load(first) {
    let raw;
    try {
      const res = await fetch('data/season.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      raw = await res.json();
    } catch {
      if (first) $('#status').textContent = 'No box scores yet. The first update runs within 30 minutes of setup.';
      return;
    }
    if (!raw.lines?.length) {
      $('#status').textContent = 'No finished games yet. Box scores appear here within 30 minutes of each final buzzer.';
      return;
    }
    const wasLatest = !S.night || S.night === nights[0];
    S.data = build(raw);
    if (first) readURL();
    if (!S.night || (wasLatest && !first)) S.night = nights[0];
    if (!S.a || !S.b) {
      const top = S.data.rows.filter((l) => l.d === S.night).sort((x, y) => y.gs - x.gs);
      S.a = S.a || top[0]?.p || null;
      S.b = S.b || top.find((l) => l.p !== S.a)?.p || null;
    }
    indexPlayers();
    renderAll();
  }

  load(true);
  // Pick up new games without a reload while the page stays open.
  setInterval(() => { if (document.visibilityState === 'visible') load(false); }, 10 * 60 * 1000);
  setInterval(() => S.data && renderStatus(), 60 * 1000);
})();
