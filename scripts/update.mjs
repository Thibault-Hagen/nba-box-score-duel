// Pulls completed NBA games from ESPN's free public JSON endpoints and
// appends every player's box line to site/data/season.json.
// Runs in GitHub Actions on a schedule (Node 20+, no dependencies).

import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.ESPN_BASE || 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const OUT = process.env.OUT || 'site/data/season.json';
const SEASON_START = process.env.SEASON_START || '2026-10-01';
const RESCAN_DAYS = 3; // always re-check the last few days for late finishes / stat corrections

// Column order for each box line (kept in the file so the site never guesses).
const FIELDS = ['g', 'p', 'tm', 'opp', 'min', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov',
  'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'oreb', 'dreb', 'pf', 'pm', 'st'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 4) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'box-score-duel/1.0', Accept: 'application/json' } });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === tries) throw new Error(`${url}: ${err.message}`);
      await sleep(800 * i);
    }
  }
}

function todayET() {
  if (process.env.TODAY) return process.env.TODAY;
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const int = (v) => {
  const n = parseInt(String(v ?? '').replace('+', ''), 10);
  return Number.isFinite(n) ? n : 0;
};
const pair = (v) => {
  const [a, b] = String(v ?? '').split('-');
  return [int(a), int(b)];
};

// ESPN labels are stable ("MIN","PTS","FG","3PT"...), but their order has changed over the
// years, so every value is read by label, with the long key names as a fallback.
const ALIASES = {
  MIN: ['MIN', 'MINUTES'], PTS: ['PTS', 'POINTS'], FG: ['FG', 'FIELDGOALSMADE-FIELDGOALSATTEMPTED'],
  '3PT': ['3PT', 'THREEPOINTFIELDGOALSMADE-THREEPOINTFIELDGOALSATTEMPTED'],
  FT: ['FT', 'FREETHROWSMADE-FREETHROWSATTEMPTED'], REB: ['REB', 'REBOUNDS'], AST: ['AST', 'ASSISTS'],
  TO: ['TO', 'TURNOVERS'], STL: ['STL', 'STEALS'], BLK: ['BLK', 'BLOCKS'],
  OREB: ['OREB', 'OFFENSIVEREBOUNDS'], DREB: ['DREB', 'DEFENSIVEREBOUNDS'], PF: ['PF', 'FOULS'],
  '+/-': ['+/-', 'PLUSMINUS'],
};

function parseSummary(eventId, summary, game, db) {
  const lines = [];
  for (const block of summary?.boxscore?.players ?? []) {
    const tm = block.team?.abbreviation;
    const opp = tm === game.h ? game.a : game.h;
    const st = block.statistics?.[0];
    if (!tm || !st) continue;
    const labels = (st.labels ?? []).map((x) => String(x).toUpperCase());
    const keys = (st.keys ?? st.names ?? []).map((x) => String(x).toUpperCase());
    const col = (name) => {
      for (const alias of ALIASES[name]) {
        let i = labels.indexOf(alias);
        if (i < 0) i = keys.indexOf(alias);
        if (i >= 0) return i;
      }
      return -1;
    };
    const idx = Object.fromEntries(Object.keys(ALIASES).map((k) => [k, col(k)]));

    for (const a of st.athletes ?? []) {
      const ath = a.athlete;
      if (!ath?.id || a.didNotPlay || !a.stats?.length) continue;
      const v = (k) => (idx[k] < 0 ? '' : a.stats[idx[k]]);
      const min = int(v('MIN'));
      if (min <= 0) continue;
      const [fgm, fga] = pair(v('FG'));
      const [tpm, tpa] = pair(v('3PT'));
      const [ftm, fta] = pair(v('FT'));
      const oreb = int(v('OREB'));
      const dreb = int(v('DREB'));
      const reb = idx.REB >= 0 ? int(v('REB')) : oreb + dreb;
      lines.push([eventId, ath.id, tm, opp, min, int(v('PTS')), reb, int(v('AST')), int(v('STL')),
        int(v('BLK')), int(v('TO')), fgm, fga, tpm, tpa, ftm, fta, oreb, dreb, int(v('PF')),
        int(v('+/-')), a.starter ? 1 : 0]);
      db.players[ath.id] = {
        n: ath.displayName || ath.shortName || 'Unknown',
        pos: ath.position?.abbreviation || '',
        tm,
        hs: ath.headshot?.href || `https://a.espncdn.com/i/headshots/nba/players/full/${ath.id}.png`,
      };
    }
  }
  return lines;
}

async function load() {
  try {
    const db = JSON.parse(await fs.readFile(OUT, 'utf8'));
    if (db.version === 1) return db;
  } catch {}
  return { version: 1, updated: null, fields: FIELDS, days: {}, teams: {}, games: {}, players: {}, lines: [] };
}

async function main() {
  const db = await load();
  const startSig = JSON.stringify({ ...db, updated: null });
  const today = todayET();
  const recentCutoff = addDays(today, -RESCAN_DAYS);
  let newGames = 0;

  for (let d = SEASON_START; d <= today; d = addDays(d, 1)) {
    if (db.days[d] === 'done' && d < recentCutoff) continue;
    const sb = await getJSON(`${BASE}/scoreboard?dates=${d.replaceAll('-', '')}&limit=50`);
    const events = (sb?.events ?? []).filter((e) => {
      const type = e.season?.type ?? 2;
      const teams = e.competitions?.[0]?.competitors ?? [];
      // skip preseason and exhibitions (All-Star etc. use non-franchise team ids)
      return type !== 1 && teams.length === 2 && teams.every((c) => int(c.team?.id) >= 1 && int(c.team?.id) <= 30);
    });

    let allDone = true;
    for (const e of events) {
      const comp = e.competitions[0];
      const done = e.status?.type?.completed ?? comp.status?.type?.completed;
      if (!done) { allDone = false; continue; }
      const home = comp.competitors.find((c) => c.homeAway === 'home');
      const away = comp.competitors.find((c) => c.homeAway === 'away');
      for (const c of [home, away]) {
        db.teams[c.team.abbreviation] = { n: c.team.displayName, c: c.team.color ? `#${c.team.color}` : null };
      }
      const game = { d, h: home.team.abbreviation, a: away.team.abbreviation, hs: int(home.score), as: int(away.score), t: e.season?.type ?? 2 };
      const known = db.games[e.id];
      const fresh = !known || known.hs !== game.hs || known.as !== game.as || d >= recentCutoff;
      if (!fresh) continue;

      const summary = await getJSON(`${BASE}/summary?event=${e.id}`);
      const lines = parseSummary(e.id, summary, game, db);
      if (!lines.length) { allDone = false; continue; } // box score not posted yet; retry next run
      db.lines = db.lines.filter((l) => l[0] !== e.id).concat(lines);
      if (!known) newGames++;
      db.games[e.id] = game;
      await sleep(150);
    }
    if (allDone && d < today) db.days[d] = 'done';
  }

  const key = (l) => `${db.games[l[0]].d}|${l[0]}|${l[2]}|${l[21] ? 0 : 1}|${l[1]}`;
  db.lines.sort((x, y) => (key(x) < key(y) ? -1 : key(x) > key(y) ? 1 : 0));
  if (JSON.stringify({ ...db, updated: null }) === startSig) {
    console.log(`no change (${Object.keys(db.games).length} games)`);
    return; // leave the file untouched so the workflow makes no commit
  }
  db.updated = new Date().toISOString();
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(db));
  console.log(`games: ${Object.keys(db.games).length} (+${newGames} new), box lines: ${db.lines.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
