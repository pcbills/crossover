const crypto = require('crypto');
const { CATEGORIES } = require('./categories');

const TOTAL_ROUNDS = 5;
const MAX_NAME = 20;
const MAX_ANSWER = 200;
const MIN_PLAYERS = 2;

const PHASES = ['lobby', 'writing', 'voting', 'results', 'final'];

function id() {
  return crypto.randomBytes(8).toString('hex');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cleanText(s, max) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

class GameError extends Error {}

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // playerId -> player
    this.adminId = null;
    this.categories = ['everything'];
    this.totalRounds = TOTAL_ROUNDS;
    this.resetGame();
  }

  resetGame() {
    this.phase = 'lobby';
    this.round = 0;
    this.usedIps = new Set();
    this.prompt = null;
    this.answers = new Map(); // playerId -> { id, text }
    this.votes = new Map(); // playerId -> [answerId, ...] best first
    this.roundPlayers = new Set(); // players expected to act this round
    this.lastResults = null;
    for (const p of this.players.values()) p.score = 0;
  }

  // ---------- players ----------

  addPlayer(name) {
    name = cleanText(name, MAX_NAME);
    if (!name) throw new GameError('Please enter a name.');
    const taken = [...this.players.values()].some(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    if (taken) throw new GameError('That name is already taken in this game.');
    const player = { id: id(), name, score: 0, connected: true };
    this.players.set(player.id, player);
    if (!this.adminId) this.adminId = player.id;
    // Late joiners can still write an answer if the round is in its writing phase.
    if (this.phase === 'writing') this.roundPlayers.add(player.id);
    return player;
  }

  setConnected(playerId, connected) {
    const p = this.players.get(playerId);
    if (p) p.connected = connected;
  }

  connectedPlayers() {
    return [...this.players.values()].filter((p) => p.connected);
  }

  // Hand admin rights to someone who is still here.
  ensureAdmin() {
    const admin = this.players.get(this.adminId);
    if (admin && admin.connected) return false;
    const next = this.connectedPlayers()[0];
    if (next && next.id !== this.adminId) {
      this.adminId = next.id;
      return true;
    }
    return false;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    this.roundPlayers.delete(playerId);
    this.answers.delete(playerId);
    this.votes.delete(playerId);
    if (this.adminId === playerId) {
      this.adminId = null;
      const next = this.connectedPlayers()[0] || [...this.players.values()][0];
      if (next) this.adminId = next.id;
    }
    this.maybeAdvance();
  }

  requireAdmin(playerId) {
    if (playerId !== this.adminId) throw new GameError('Only the game admin can do that.');
  }

  // ---------- admin actions ----------

  // Pick one or more categories. "everything" can't be combined with others
  // (it already includes them all).
  setCategories(playerId, categories) {
    this.requireAdmin(playerId);
    if (this.phase !== 'lobby') throw new GameError('You can only change categories in the lobby.');
    if (!Array.isArray(categories)) categories = [categories];
    const picked = [...new Set(categories)];
    if (picked.length === 0) throw new GameError('Pick at least one category.');
    if (!picked.every((c) => CATEGORIES[c])) throw new GameError('Unknown category.');
    this.categories = picked.includes('everything') ? ['everything'] : picked;
  }

  categoryLabel() {
    return this.categories.map((c) => CATEGORIES[c].label).join(' + ');
  }

  startGame(playerId) {
    this.requireAdmin(playerId);
    if (this.phase !== 'lobby') throw new GameError('The game has already started.');
    if (this.connectedPlayers().length < MIN_PLAYERS) {
      throw new GameError(`You need at least ${MIN_PLAYERS} players to start.`);
    }
    this.resetGame();
    this.startRound();
  }

  nextRound(playerId) {
    this.requireAdmin(playerId);
    if (this.phase !== 'results') throw new GameError('Not ready for the next round.');
    if (this.round >= this.totalRounds) {
      this.phase = 'final';
    } else {
      this.startRound();
    }
  }

  newGame(playerId) {
    this.requireAdmin(playerId);
    if (this.phase !== 'final') throw new GameError('The current game is not over yet.');
    this.resetGame();
  }

  // Admin can stop waiting for stragglers.
  forceAdvance(playerId) {
    this.requireAdmin(playerId);
    if (this.phase === 'writing') this.endWriting();
    else if (this.phase === 'voting') this.endVoting();
    else throw new GameError('Nothing to skip right now.');
  }

  kick(playerId, targetId) {
    this.requireAdmin(playerId);
    if (targetId === playerId) throw new GameError("You can't remove yourself.");
    if (!this.players.has(targetId)) throw new GameError('No such player.');
    this.removePlayer(targetId);
  }

  // ---------- round flow ----------

  pickPrompt() {
    const pool = [...new Set(this.categories.flatMap((c) => CATEGORIES[c].ips))];
    let available = pool.filter((ip) => !this.usedIps.has(ip));
    if (available.length < 2) {
      this.usedIps.clear();
      available = pool;
    }
    const [a, b] = shuffle(available);
    this.usedIps.add(a);
    this.usedIps.add(b);
    return { a, b };
  }

  startRound() {
    this.round += 1;
    this.phase = 'writing';
    this.prompt = this.pickPrompt();
    this.answers = new Map();
    this.votes = new Map();
    this.lastResults = null;
    this.roundPlayers = new Set(this.connectedPlayers().map((p) => p.id));
  }

  submitAnswer(playerId, text) {
    if (this.phase !== 'writing') throw new GameError('Answers are closed.');
    if (!this.players.has(playerId)) throw new GameError('You are not in this game.');
    text = cleanText(text, MAX_ANSWER);
    if (!text) throw new GameError('Write something first!');
    this.roundPlayers.add(playerId);
    this.answers.set(playerId, { id: id(), text });
    this.maybeAdvance();
  }

  // Players we are still waiting on in the current phase. Disconnected players
  // still count (phones go to sleep!) — the admin can skip them if needed.
  pending() {
    const waiting = [];
    for (const pid of this.roundPlayers) {
      if (!this.players.has(pid)) continue;
      if (this.phase === 'writing' && !this.answers.has(pid)) waiting.push(pid);
      if (this.phase === 'voting' && this.ballotFor(pid).length > 0 && !this.votes.has(pid)) {
        waiting.push(pid);
      }
    }
    return waiting;
  }

  maybeAdvance() {
    if (this.phase !== 'writing' && this.phase !== 'voting') return;
    if (this.pending().length > 0) return;
    if (this.phase === 'writing') this.endWriting();
    else this.endVoting();
  }

  endWriting() {
    // Shuffle once so every player sees the answers in the same anonymous order.
    this.answerOrder = shuffle([...this.answers.entries()].map(([pid, a]) => ({ ...a, playerId: pid })));
    if (this.answerOrder.length === 0) {
      this.lastResults = { answers: [] };
      this.phase = 'results';
      return;
    }
    this.phase = 'voting';
    // Everyone connected may vote, even if they didn't write an answer.
    for (const p of this.connectedPlayers()) this.roundPlayers.add(p.id);
    this.maybeAdvance(); // e.g. only one answer, written by the only voter
  }

  // The answers a given player should rank: everything except their own.
  ballotFor(playerId) {
    return (this.answerOrder || []).filter((a) => a.playerId !== playerId);
  }

  submitVote(playerId, ranking) {
    if (this.phase !== 'voting') throw new GameError('Voting is closed.');
    if (!this.players.has(playerId)) throw new GameError('You are not in this game.');
    const ballot = this.ballotFor(playerId).map((a) => a.id);
    if (!Array.isArray(ranking)) throw new GameError('Invalid ranking.');
    const valid =
      ranking.length === ballot.length &&
      new Set(ranking).size === ranking.length &&
      ranking.every((r) => ballot.includes(r));
    if (!valid) throw new GameError('Please rank every answer exactly once.');
    this.roundPlayers.add(playerId);
    this.votes.set(playerId, ranking);
    this.maybeAdvance();
  }

  // Scoring: a ballot of N answers gives N points to the #1 pick,
  // N-1 to #2, ... and 1 point to the last place answer.
  endVoting() {
    const byAnswer = new Map(this.answerOrder.map((a) => [a.id, { ...a, points: 0, firsts: 0 }]));
    for (const ranking of this.votes.values()) {
      ranking.forEach((answerId, i) => {
        const entry = byAnswer.get(answerId);
        if (!entry) return;
        entry.points += ranking.length - i;
        if (i === 0) entry.firsts += 1;
      });
    }
    const answers = [...byAnswer.values()].sort((x, y) => y.points - x.points || y.firsts - x.firsts);
    for (const a of answers) {
      const p = this.players.get(a.playerId);
      if (p) p.score += a.points;
    }
    this.lastResults = { answers };
    this.phase = 'results';
  }

  // ---------- views ----------

  scoreboard() {
    return [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  winners() {
    const board = this.scoreboard();
    if (board.length === 0) return [];
    const top = board[0].score;
    return board.filter((p) => p.score === top);
  }

  // What a single player is allowed to see.
  viewFor(playerId) {
    const me = this.players.get(playerId);
    const pending = new Set(this.pending());
    const view = {
      code: this.code,
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      categories: this.categories,
      categoryLabel: this.categoryLabel(),
      isAdmin: playerId === this.adminId,
      adminName: this.players.get(this.adminId)?.name ?? null,
      me: me ? { id: me.id, name: me.name, score: me.score } : null,
      minPlayers: MIN_PLAYERS,
      players: this.scoreboard().map((p) => ({ ...p, waiting: pending.has(p.id) })),
      prompt: this.prompt,
    };

    if (this.phase === 'writing') {
      view.myAnswer = this.answers.get(playerId)?.text ?? null;
      view.submittedCount = this.answers.size;
    }
    if (this.phase === 'voting') {
      view.ballot = this.ballotFor(playerId).map((a) => ({ id: a.id, text: a.text }));
      view.myAnswer = this.answers.get(playerId)?.text ?? null;
      view.hasVoted = this.votes.has(playerId);
    }
    if (this.phase === 'results' && this.lastResults) {
      view.results = this.lastResults.answers.map((a) => ({
        text: a.text,
        points: a.points,
        firsts: a.firsts,
        author: this.players.get(a.playerId)?.name ?? '(left the game)',
        mine: a.playerId === playerId,
      }));
      view.isLastRound = this.round >= this.totalRounds;
    }
    if (this.phase === 'final') {
      view.winners = this.winners().map((w) => w.name);
    }
    return view;
  }
}

module.exports = { Room, GameError, PHASES, TOTAL_ROUNDS, MAX_ANSWER, MAX_NAME };
