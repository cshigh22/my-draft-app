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
roomSchema.add({
  finishedAt: { type: Date, default: null }
});
// Documents expire 1 day after finishedAt
roomSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 86400 });
const Room = mongoose.model('Room', roomSchema);

// ─── Load Players CSV ─────────────────────────────────────────────────────────
const csvPath = path.join(__dirname, 'FantasyPros_2025_Dynasty_ALL_Rankings.csv');
const csv     = fs.readFileSync(csvPath, 'utf8');
const { data: players } = Papa.parse(csv, { header: true });
console.log(`✅ Loaded ${players.length} players`);

// ─── Express & Socket.IO Setup ───────────────────────────────────────────────
const app = express();

// Allow all origins (or replace '*' with your exact Vercel URL if you prefer)
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: '*',           // or ['https://keeper-fawn.vercel.app']
    methods: ['GET','POST']
  }
});

// ─── Socket.IO Handlers ──────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('🔌', socket.id, 'connected');

  socket.on('joinRoom', async ({ code, nickname }, ack) => {
    try {
      const roomCode = code.toUpperCase();
      let room = await Room.findOne({ code: roomCode });
      if (!room) {
        room = await Room.create({ code: roomCode, players: [] });
      }

      // Re‑bind existing nickname or add new one
      const existing = room.players.find(p => p.nickname === nickname);
      if (existing) {
        const oldId = existing.id;
        existing.id = socket.id;
        if (room.started) {
          room.draftOrderSocketIds = room.draftOrderSocketIds.map(id =>
            id === oldId ? socket.id : id
          );
        }
      } else {
        room.players.push({ id: socket.id, nickname });
      }

      await room.save();
      socket.join(roomCode);

      // broadcast updated lobby
      io.to(roomCode).emit('updateLobby', room.players.map(p => p.nickname));

      // replay draft state if already started
      if (room.started) {
        socket.emit('draftStarted', {
          draftOrderNicknames: room.draftOrderNicknames,
          draftOrderSocketIds: room.draftOrderSocketIds,
          playersPool:         room.availablePlayers
        });
        socket.emit('updateDraft', {
          picks:            room.picks,
          availablePlayers: room.availablePlayers,
          nextPicker:       room.draftOrderSocketIds[
            room.picks.findIndex(p => p === null)
          ]
        });
      }

      ack({ success: true });
    } catch (err) {
      console.error('❌ joinRoom error', err);
      ack({ success: false, error: 'Server error during join' });
    }
  });

  socket.on('startDraft', async ({ code, draftOrder }) => {
    const roomCode = code.toUpperCase();
    const room = await Room.findOne({ code: roomCode });
    if (!room) return console.error('❌ startDraft: invalid room');

    const nameToId = Object.fromEntries(room.players.map(p => [p.nickname, p.id]));
    const flatIds  = draftOrder.map(n => nameToId[n]);

    room.draftOrderNicknames = draftOrder;
    room.draftOrderSocketIds = flatIds;
    room.numRounds           = flatIds.length / room.players.length;
    room.availablePlayers    = players;
    room.picks               = Array(flatIds.length).fill(null);
    room.started             = true;
    await room.save();

    io.to(roomCode).emit('draftStarted', {
      draftOrderNicknames: room.draftOrderNicknames,
      draftOrderSocketIds: room.draftOrderSocketIds,
      playersPool:         room.availablePlayers
    });
    console.log(`🚀 Draft started in room ${roomCode}`);
  });

  socket.on('makePick', async ({ code, playerName, pickIndex }) => {
    const room = await Room.findOne({ code: code.toUpperCase() });
    if (!room || room.picks[pickIndex]) return;

    // store full player object for coloring later
    const playerObj = room.availablePlayers.find(p => p['PLAYER NAME'] === playerName);
    room.picks[pickIndex] = { ...playerObj, socketId: socket.id };

    room.availablePlayers = room.availablePlayers.filter(
      p => p['PLAYER NAME'] !== playerName
    );

    if (room.picks.every(p => p !== null)) {
      room.finishedAt = new Date();
      await room.save();
      io.to(room.code).emit('draftEnded', { finalPicks: room.picks });
      console.log(`🏁 Draft ended in room ${room.code}`);
      return;
    }

    await room.save();
    const nextIdx    = room.picks.findIndex(p => p === null);
    const nextSocket = room.draftOrderSocketIds[nextIdx];
    io.to(room.code).emit('updateDraft', {
      picks:            room.picks,
      availablePlayers: room.availablePlayers,
      nextPicker:       nextSocket
    });
  });

  socket.on('disconnect', () => console.log('❌', socket.id, 'disconnected'));
});

// ─── REST Endpoints ──────────────────────────────────────────────────────────
app.get('/room/:code', async (req, res) => {
  const room = await Room.findOne({ code: req.params.code.toUpperCase() });
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    players:             room.players.map(p => p.nickname),
    started:             room.started,
    draftOrderNicknames: room.draftOrderNicknames,
    picks:               room.picks,
    availablePlayers:    room.availablePlayers
  });
});

app.delete('/room/:code', async (req, res) => {
  const result = await Room.deleteOne({ code: req.params.code.toUpperCase() });
  if (!result.deletedCount) return res.status(404).json({ error: 'Room not found' });
  res.json({ success: true });
});

// ─── Healthcheck & Server Start ─────────────────────────────────────────────
app.get('/', (req, res) => res.send('🏈 Draft Server Running'));
const PORT = process.env.PORT || 3001;
server.listen(PORT, () =>
  console.log(`🌐 Listening on port ${PORT}`)
);
