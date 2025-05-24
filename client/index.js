// index.js
require('dotenv').config();                              // Load .env first
const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const Papa       = require('papaparse');
const mongoose   = require('mongoose');
const { Server } = require('socket.io');

// ─── MongoDB Connection ─────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ Missing MONGO_URI in environment. Check your .env');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ─── Room Schema with TTL index ───────────────────────────────────────────────
const roomSchema = new mongoose.Schema({
  code:                { type: String, unique: true },
  players:             [{ id: String, nickname: String }],
  draftOrderNicknames: [String],
  draftOrderSocketIds: [String],
  picks:               [mongoose.Schema.Types.Mixed],
  availablePlayers:    [mongoose.Schema.Types.Mixed],
  numRounds:           Number,
  started:             { type: Boolean, default: false }
});

// Add finishedAt for TTL expiration
roomSchema.add({
  finishedAt: { type: Date, default: null }
});
// Documents expire 1 hour after finishedAt
roomSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 86400 });

const Room = mongoose.model('Room', roomSchema);

// ─── Load Players CSV ─────────────────────────────────────────────────────────
const csvPath = path.join(__dirname, 'FantasyPros_2025_Dynasty_ALL_Rankings.csv');
const csv     = fs.readFileSync(csvPath, 'utf8');
const { data: players } = Papa.parse(csv, { header: true });
console.log(`✅ Loaded ${players.length} players`);

// ─── Express & Socket.IO Setup ───────────────────────────────────────────────
const app    = express();
app.use(cors());
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

// ─── Socket.IO Handlers ──────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('🔌', socket.id, 'connected');

  socket.on('joinRoom', async ({ code, nickname }) => {
    let room = await Room.findOne({ code });
    if (!room) room = await Room.create({ code, players: [] });

    // Only allow existing players after start
    if (room.started) {
      const existing = room.players.find(p => p.nickname === nickname);
      if (!existing) {
        return socket.emit('joinError', { message: 'Draft in progress—only existing managers may re‑join.' });
      }
    }

    // Update or add player
    const existingPlayer = room.players.find(p => p.nickname === nickname);
    if (existingPlayer) {
      const oldId = existingPlayer.id;
      existingPlayer.id = socket.id;
      if (room.started) {
        room.draftOrderSocketIds = room.draftOrderSocketIds.map(id => id === oldId ? socket.id : id);
      }
    } else {
      room.players.push({ id: socket.id, nickname });
    }
    await room.save();

    socket.join(code);
    io.to(code).emit('updateLobby', room.players.map(p => p.nickname));

    if (room.started) {
      // Replay draft state
      socket.emit('draftStarted', {
        draftOrderNicknames: room.draftOrderNicknames,
        draftOrderSocketIds: room.draftOrderSocketIds,
        playersPool:         room.availablePlayers
      });
      socket.emit('updateDraft', {
        picks:            room.picks,
        availablePlayers: room.availablePlayers,
        nextPicker:       room.draftOrderSocketIds[room.picks.findIndex(p => p === null)]
      });
    }
  });

  socket.on('startDraft', async ({ code, draftOrder }) => {
    const room = await Room.findOne({ code });
    if (!room) return;

    const nameToId = Object.fromEntries(room.players.map(p => [p.nickname, p.id]));
    const flatIds  = draftOrder.map(n => nameToId[n]);

    room.draftOrderNicknames = draftOrder;
    room.draftOrderSocketIds = flatIds;
    room.numRounds           = flatIds.length / room.players.length;
    room.availablePlayers    = players;
    room.picks               = Array(flatIds.length).fill(null);
    room.started             = true;
    await room.save();

    io.to(code).emit('draftStarted', {
      draftOrderNicknames: room.draftOrderNicknames,
      draftOrderSocketIds: room.draftOrderSocketIds,
      playersPool:         room.availablePlayers
    });
    console.log(`🚀 Draft started in room ${code}: ${room.players.length} managers × ${room.numRounds} rounds`);
  });

  socket.on('makePick', async ({ code, playerName, pickIndex }) => {
    const room = await Room.findOne({ code });
    if (!room || room.picks[pickIndex]) return;

    room.picks[pickIndex] = { socketId: socket.id, playerName };
    room.availablePlayers = room.availablePlayers.filter(p => p['PLAYER NAME'] !== playerName);

    // If draft complete, set finishedAt for TTL deletion
    if (room.picks.every(p => p !== null)) {
      room.finishedAt = new Date();
      await room.save();
      io.to(code).emit('draftEnded', { finalPicks: room.picks });
      console.log(`🏁 Draft ended in room ${code}`);
      return;
    }

    await room.save();

    const nextIdx   = room.picks.findIndex(p => p === null);
    const nextPicker = nextIdx === -1 ? null : room.draftOrderSocketIds[nextIdx];
    io.to(code).emit('updateDraft', {
      picks:            room.picks,
      availablePlayers: room.availablePlayers,
      nextPicker
    });
  });

  socket.on('disconnect', () => console.log('❌', socket.id, 'disconnected'));
});

// ─── REST Endpoints ─────────────────────────────────────────────────────────
app.get('/room/:code', async (req, res) => {
  const room = await Room.findOne({ code: req.params.code });
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    players:             room.players.map(p => p.nickname),
    started:             room.started,
    draftOrderNicknames: room.draftOrderNicknames,
    picks:               room.picks,
    availablePlayers:    room.availablePlayers
  });
});

// Manual delete endpoint
app.delete('/room/:code', async (req, res) => {
  const result = await Room.deleteOne({ code: req.params.code });
  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({ success: true });
});

// Health check
app.get('/', (req, res) => res.send('🏈 Draft Server Running'));

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🌐 Listening on port ${PORT}`));