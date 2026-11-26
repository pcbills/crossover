const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { Room, GameError } = require('./src/game');
const { listCategories } = require('./src/categories');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/+$/, '');
const ADMIN_GRACE_MS = 30_000; // how long the admin can drop off before handing over
const ROOM_IDLE_MS = 60 * 60_000; // remove rooms nobody has touched for an hour

const app = express();
const server = http.createServer(app);
const io = new Server(server);

/** @type {Map<string, Room>} */
const rooms = new Map();

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
  let code;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function lanAddress() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

// Work out the URL other phones should open. If the admin is browsing on
// "localhost" that URL is useless to anyone else, so swap in the LAN IP.
function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  let host = req.headers['x-forwarded-host'] || req.headers.host;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host)) {
    const lan = lanAddress();
    if (lan) host = host.replace(/^(localhost|127\.0\.0\.1|\[::1\])/, lan);
  }
  return `${proto}://${host}`;
}

app.set('trust proxy', true);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/categories', (_req, res) => res.json(listCategories()));

app.get('/api/join/:code', async (req, res) => {
  const code = req.params.code.toUpperCase();
  if (!rooms.has(code)) return res.status(404).json({ error: 'No such game' });
  const url = `${baseUrl(req)}/?room=${code}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  res.json({ url, svg });
});

app.get('/healthz', (_req, res) => res.send('ok'));

// ---------- sockets ----------

function broadcast(room) {
  room.touched = Date.now();
  for (const [socketId, s] of io.sockets.sockets) {
    if (s.data.code === room.code && s.data.playerId) {
      io.to(socketId).emit('state', room.viewFor(s.data.playerId));
    }
  }
}

function scheduleAdminHandover(room) {
  clearTimeout(room.adminTimer);
  room.adminTimer = setTimeout(() => {
    if (room.ensureAdmin()) broadcast(room);
  }, ADMIN_GRACE_MS);
}

io.on('connection', (socket) => {
  // Wrap handlers so game rule violations come back to the client as a message.
  const on = (event, fn) =>
    socket.on(event, (payload, ack = () => {}) => {
      try {
        const result = fn(payload || {});
        ack({ ok: true, ...result });
      } catch (err) {
        if (!(err instanceof GameError)) console.error(err);
        ack({ ok: false, error: err instanceof GameError ? err.message : 'Something went wrong.' });
      }
    });

  const currentRoom = () => {
    const room = rooms.get(socket.data.code);
    if (!room || !room.players.has(socket.data.playerId)) {
      throw new GameError('You are not in a game. Try refreshing.');
    }
    return room;
  };

  const attach = (room, player) => {
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
    room.setConnected(player.id, true);
    broadcast(room);
    return { code: room.code, playerId: player.id };
  };

  on('create', ({ name, categories, rounds }) => {
    const room = new Room(makeCode());
    const player = room.addPlayer(name);
    if (categories) room.setCategories(player.id, categories);
    if (rounds != null) room.setRounds(player.id, rounds);
    rooms.set(room.code, room);
    return attach(room, player);
  });

  on('join', ({ code, name }) => {
    const room = rooms.get(String(code || '').toUpperCase().trim());
    if (!room) throw new GameError("Couldn't find that game. Check the code?");
    return attach(room, room.addPlayer(name));
  });

  // Phones sleep and reload constantly; let them pick up where they left off.
  on('resume', ({ code, playerId }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    const player = room?.players.get(playerId);
    if (!player) throw new GameError('That game has ended.');
    return attach(room, player);
  });

  on('leave', () => {
    const room = currentRoom();
    room.removePlayer(socket.data.playerId);
    socket.leave(room.code);
    socket.data.code = socket.data.playerId = null;
    broadcast(room);
  });

  const action = (event, fn) =>
    on(event, (payload) => {
      const room = currentRoom();
      fn(room, socket.data.playerId, payload);
      broadcast(room);
    });

  action('setCategories', (room, pid, { categories }) => room.setCategories(pid, categories));
  action('setCustomItems', (room, pid, { items }) => room.setCustomItems(pid, items));
  action('setRounds', (room, pid, { rounds }) => room.setRounds(pid, rounds));
  action('start', (room, pid) => room.startGame(pid));
  action('answer', (room, pid, { text }) => room.submitAnswer(pid, text));
  action('vote', (room, pid, { ranking }) => room.submitVote(pid, ranking));
  action('next', (room, pid) => room.nextRound(pid));
  action('reroll', (room, pid) => room.reroll(pid));
  action('skip', (room, pid) => room.forceAdvance(pid));
  action('newGame', (room, pid) => room.newGame(pid));
  action('kick', (room, pid, { playerId }) => {
    room.kick(pid, playerId);
    for (const s of io.sockets.sockets.values()) {
      if (s.data.playerId === playerId) {
        s.emit('kicked');
        s.data.code = s.data.playerId = null;
      }
    }
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    const pid = socket.data.playerId;
    if (!room || !room.players.has(pid)) return;
    // Only mark offline if they have no other open tab.
    const stillHere = [...io.sockets.sockets.values()].some(
      (s) => s.id !== socket.id && s.data.playerId === pid
    );
    if (stillHere) return;
    room.setConnected(pid, false);
    if (pid === room.adminId) scheduleAdminHandover(room);
    broadcast(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.connectedPlayers().length === 0 && now - (room.touched || 0) > ROOM_IDLE_MS) {
      clearTimeout(room.adminTimer);
      rooms.delete(code);
    }
  }
}, 5 * 60_000).unref();

server.listen(PORT, () => {
  const lan = lanAddress();
  console.log(`Crossover is running!`);
  console.log(`  On this computer:  http://localhost:${PORT}`);
  if (lan) console.log(`  On your Wi-Fi:     http://${lan}:${PORT}`);
  if (PUBLIC_URL) console.log(`  Public URL:        ${PUBLIC_URL}`);
});
