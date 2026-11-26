const test = require('node:test');
const assert = require('node:assert');
const { Room, GameError } = require('../src/game');

function setup(names = ['Ann', 'Ben', 'Cat']) {
  const room = new Room('TEST');
  const players = names.map((n) => room.addPlayer(n));
  return { room, players };
}

function answerAll(room, players) {
  players.forEach((p, i) => room.submitAnswer(p.id, `line ${i}`));
}

test('first player is admin and duplicate names are rejected', () => {
  const { room, players } = setup();
  assert.strictEqual(room.adminId, players[0].id);
  assert.throws(() => room.addPlayer('ann'), GameError);
});

test('only the admin can start, and needs 2+ players', () => {
  const solo = new Room('SOLO');
  const a = solo.addPlayer('A');
  assert.throws(() => solo.startGame(a.id), /at least 2/);
  const { room, players } = setup();
  assert.throws(() => room.startGame(players[1].id), /admin/);
  room.startGame(players[0].id);
  assert.strictEqual(room.phase, 'writing');
  assert.strictEqual(room.round, 1);
  assert.notStrictEqual(room.prompt.a, room.prompt.b);
});

test('voting begins once everyone answers; players never see their own answer', () => {
  const { room, players } = setup();
  room.setCategories(players[0].id, ['cartoons']);
  room.startGame(players[0].id);
  room.submitAnswer(players[0].id, 'hi');
  assert.strictEqual(room.phase, 'writing');
  room.submitAnswer(players[1].id, 'yo');
  room.submitAnswer(players[2].id, 'hey');
  assert.strictEqual(room.phase, 'voting');
  const view = room.viewFor(players[0].id);
  assert.strictEqual(view.ballot.length, 2);
  assert.ok(!view.ballot.some((a) => a.text === 'hi'));
  // No author info leaks into the ballot.
  assert.deepStrictEqual(Object.keys(view.ballot[0]).sort(), ['id', 'text']);
});

test('ranked scoring: #1 of N gets N points, last gets 1', () => {
  const { room, players } = setup();
  room.startGame(players[0].id);
  answerAll(room, players);
  const idOf = (pid) => room.answers.get(pid).id;
  const [A, B, C] = players.map((p) => p.id);
  room.submitVote(A, [idOf(B), idOf(C)]); // B:2, C:1
  room.submitVote(B, [idOf(C), idOf(A)]); // C:2, A:1
  room.submitVote(C, [idOf(B), idOf(A)]); // B:2, A:1
  assert.strictEqual(room.phase, 'results');
  assert.strictEqual(room.players.get(A).score, 2);
  assert.strictEqual(room.players.get(B).score, 4);
  assert.strictEqual(room.players.get(C).score, 3);
  assert.strictEqual(room.viewFor(A).results[0].author, 'Ben');
});

test('invalid rankings are rejected', () => {
  const { room, players } = setup();
  room.startGame(players[0].id);
  answerAll(room, players);
  const own = room.answers.get(players[0].id).id;
  const other = room.answers.get(players[1].id).id;
  assert.throws(() => room.submitVote(players[0].id, [own, other]), GameError);
  assert.throws(() => room.submitVote(players[0].id, [other]), GameError);
  assert.throws(() => room.submitVote(players[0].id, [other, other]), GameError);
});

test('a full game lasts 5 rounds, crowns a winner, and can restart', () => {
  const { room, players } = setup();
  const admin = players[0].id;
  room.startGame(admin);
  const seen = new Set();
  for (let r = 1; r <= 5; r++) {
    assert.strictEqual(room.round, r);
    seen.add(room.prompt.a); seen.add(room.prompt.b);
    answerAll(room, players);
    for (const p of players) room.submitVote(p.id, room.ballotFor(p.id).map((a) => a.id));
    room.nextRound(admin);
  }
  assert.strictEqual(seen.size, 10, 'no IP repeats within a game');
  assert.strictEqual(room.phase, 'final');
  assert.ok(room.viewFor(admin).winners.length >= 1);
  room.newGame(admin);
  assert.strictEqual(room.phase, 'lobby');
  room.setCategories(admin, ['fantasy']);
  assert.ok([...room.players.values()].every((p) => p.score === 0));
});

test('admin can skip stragglers; disconnected players do not auto-advance', () => {
  const { room, players } = setup();
  room.startGame(players[0].id);
  room.submitAnswer(players[0].id, 'a');
  room.submitAnswer(players[1].id, 'b');
  room.setConnected(players[2].id, false);
  room.maybeAdvance();
  assert.strictEqual(room.phase, 'writing');
  room.forceAdvance(players[0].id);
  assert.strictEqual(room.phase, 'voting');
});

test('admin role passes on when the admin leaves', () => {
  const { room, players } = setup();
  room.setConnected(players[0].id, false);
  assert.ok(room.ensureAdmin());
  assert.strictEqual(room.adminId, players[1].id);
});

test('multiple categories mix their franchises; "everything" stands alone', () => {
  const { CATEGORIES } = require('../src/categories');
  const { room, players } = setup();
  const admin = players[0].id;
  room.setCategories(admin, ['cartoons', 'videogames']);
  assert.deepStrictEqual(room.categories, ['cartoons', 'videogames']);
  assert.strictEqual(room.viewFor(admin).categoryLabel, 'Cartoons + Video Games');
  const pool = new Set([...CATEGORIES.cartoons.ips, ...CATEGORIES.videogames.ips]);
  for (let i = 0; i < 20; i++) {
    const { a, b } = room.pickPrompt();
    assert.ok(pool.has(a) && pool.has(b), `${a} / ${b} should come from the picked categories`);
  }
  room.setCategories(admin, ['cartoons', 'everything']);
  assert.deepStrictEqual(room.categories, ['everything']);
  assert.throws(() => room.setCategories(admin, []), GameError);
  assert.throws(() => room.setCategories(admin, ['cartoons', 'nope']), GameError);
  assert.throws(() => room.setCategories(players[1].id, ['movies']), /admin/);
});

test('host can set 1–7 rounds in the lobby, and the game ends after that many', () => {
  const { room, players } = setup(['Ann', 'Ben']);
  const admin = players[0].id;
  assert.strictEqual(room.totalRounds, 5);
  for (const bad of [0, 8, 2.5, 'lots']) assert.throws(() => room.setRounds(admin, bad), GameError);
  assert.throws(() => room.setRounds(players[1].id, 3), /admin/);
  room.setRounds(admin, 2);
  room.startGame(admin);
  assert.throws(() => room.setRounds(admin, 4), /lobby/);
  for (let r = 1; r <= 2; r++) {
    answerAll(room, players);
    for (const p of players) room.submitVote(p.id, room.ballotFor(p.id).map((a) => a.id));
    assert.strictEqual(room.viewFor(admin).isLastRound, r === 2);
    room.nextRound(admin);
  }
  assert.strictEqual(room.phase, 'final');
  room.newGame(admin);
  assert.strictEqual(room.totalRounds, 2, 'round count carries over to the next game');
  room.setRounds(admin, 7);
  assert.strictEqual(room.viewFor(admin).totalRounds, 7);
});
