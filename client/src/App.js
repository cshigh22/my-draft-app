// src/App.js
socket.on('connect', () => console.log('🟢 WS connected, socket id =', socket.id));
socket.on('connect_error', (err) => console.error('🔴 WS connection error:', err));
import React, { useState, useEffect, useMemo } from 'react';
import { io } from 'socket.io-client';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  AppBar,
  Toolbar,
  Typography,
  Container,
  TextField,
  Button,
  MenuItem,
  Select,
  Box,
  Grid,
  Paper,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  List,
  ListItem,
  ListItemText,
  Chip
} from '@mui/material';

// initialize socket to your deployed Railway backend
const socket = io('https://my-draft-app-production.up.railway.app', {
  transports: ['websocket']
});

const theme = createTheme({ palette: { mode: 'light' } });

// how many rounds per manager
const TOTAL_ROUNDS = 2;

// pastel colors for draft‑board columns
const pastelColors = ['#f8d7da', '#d1ecf1', '#d4edda', '#fff3cd', '#e2dfff', '#f0f0f0'];

// helper to assign each manager a consistent color
function getColorMap(players) {
  const sorted = [...players].sort();
  const map = {};
  sorted.forEach((name, idx) => {
    map[name] = pastelColors[idx % pastelColors.length];
  });
  return map;
}

export default function App() {
  // ─── Lobby state ──────────────────────────────────────────────────────────────
  const [roomCode, setRoomCode]       = useState('');
  const [nickname, setNickname]       = useState('');
  const [joined,    setJoined]        = useState(false);
  const [playerList, setPlayerList]   = useState([]);
  const [assigning, setAssigning]     = useState(false);
  const [manualDraftOrder, setManualDraftOrder] = useState([]);

  // ─── Draft state ──────────────────────────────────────────────────────────────
  const [draftStarted,       setDraftStarted]       = useState(false);
  const [availablePlayers,   setAvailablePlayers]   = useState([]);
  const [picks,              setPicks]              = useState([]);
  const [nextPicker,         setNextPicker]         = useState(null);
  const [draftOrderSocketIds,   setDraftOrderSocketIds]   = useState([]);
  const [draftOrderNicknames,   setDraftOrderNicknames]   = useState([]);
  const [draftEnded,         setDraftEnded]         = useState(false);

  // position‐filters including kicker and defense
  const positions = useMemo(() => ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'], []);
  const [filterPos, setFilterPos] = useState('All');

  // manager→color map
  const colorMap = useMemo(() => getColorMap(playerList), [playerList]);
  const getColor = name => colorMap[name] || '#f7f7f7';

  // bucket available players by position initial
  const categorized = useMemo(() => {
    const all = [...availablePlayers];
    const byPos = { All: all };
    positions.slice(1).forEach(pos => {
      byPos[pos] = all.filter(p => {
        const raw = p.POS ?? p['Pos'] ?? p.position ?? '';
        return raw.toString().charAt(0).toUpperCase() === pos.charAt(0);
      });
    });
    return byPos;
  }, [availablePlayers, positions]);

  // ─── Socket.IO event handlers ─────────────────────────────────────────────────
  useEffect(() => {
    socket.on('updateLobby', list => setPlayerList(list));

    socket.on('draftStarted', ({ draftOrderSocketIds, draftOrderNicknames, playersPool }) => {
      setDraftStarted(true);
      setDraftOrderSocketIds(draftOrderSocketIds);
      setDraftOrderNicknames(draftOrderNicknames);
      setAvailablePlayers(playersPool);
      setPicks(Array(draftOrderSocketIds.length).fill(null));
      setNextPicker(draftOrderSocketIds[0]);
      setDraftEnded(false);
    });

    socket.on('updateDraft', ({ picks, availablePlayers, nextPicker }) => {
      setPicks(picks);
      setAvailablePlayers(availablePlayers);
      setNextPicker(nextPicker);
    });

    socket.on('draftEnded', () => setDraftEnded(true));

    // handle join errors (e.g. re‑join after draft start)
    socket.on('joinError', ({ message }) => {
      alert(message);
      setJoined(false);
    });

    return () => {
      socket.off('updateLobby');
      socket.off('draftStarted');
      socket.off('updateDraft');
      socket.off('draftEnded');
      socket.off('joinError');
    };
  }, []);

  // ─── Join room (with server acknowledgment) ──────────────────────────────────
  const joinRoom = () => {
    if (!roomCode || !nickname) return;
    socket.emit(
      'joinRoom',
      { code: roomCode.toUpperCase(), nickname },
      ({ success, error }) => {
        if (success) {
          setJoined(true);
        } else {
          alert(error);
        }
      }
    );
  };

  // ─── Start manual assignment ──────────────────────────────────────────────────
  const startAssignment = () => {
    const totalSlots = playerList.length * TOTAL_ROUNDS;
    setManualDraftOrder(Array(totalSlots).fill(''));
    setAssigning(true);
  };

  // ─── Confirm assignments & start draft ────────────────────────────────────────
  const confirmAssignments = () => {
    if (manualDraftOrder.some(p => !p)) {
      alert('All picks must be assigned!');
      return;
    }
    socket.emit('startDraft', {
      code: roomCode,
      draftOrder: manualDraftOrder,
      numRounds: TOTAL_ROUNDS,
      snake: false
    });
  };

  // ─── Make a pick ──────────────────────────────────────────────────────────────
  const makePick = (player, pickIndex) => {
    socket.emit('makePick', {
      code: roomCode,
      playerName: player['PLAYER NAME'],
      pickIndex
    });
  };

  const isMyTurn = nextPicker === socket.id;
  const numRounds = playerList.length ? Math.ceil(picks.length / playerList.length) : 0;

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6">Manual Draft Room</Typography>
        </Toolbar>
      </AppBar>
      <Container sx={{ mt: 4 }}>

        {/* join vs pre‐draft vs live‐draft */}
        {!joined ? (
          // ─── Join form ─────────────────────────────────────────────
          <Box display="flex" gap={2} alignItems="center">
            <TextField
              label="Room Code"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase())}
            />
            <TextField
              label="Nickname"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
            />
            <Button variant="contained" onClick={joinRoom}>
              Join
            </Button>
          </Box>
        ) : !draftStarted ? (
          // ─── Before draft: either manual assign or lobby ────────
          assigning ? (
            <Box>
              <Typography variant="h5" gutterBottom>
                Assign Each Pick ({TOTAL_ROUNDS} Rounds)
              </Typography>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Round</TableCell>
                    {playerList.map(m => (
                      <TableCell key={m}>{m}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Array.from({ length: TOTAL_ROUNDS }).map((_, round) => (
                    <TableRow key={round}>
                      <TableCell>{round + 1}</TableCell>
                      {playerList.map((_, col) => {
                        const idx = round * playerList.length + col;
                        const sel = manualDraftOrder[idx];
                        return (
                          <TableCell
                            key={col}
                            sx={{ backgroundColor: sel ? getColor(sel) : '#fff' }}
                          >
                            <Select
                              value={sel || ''}
                              onChange={e => {
                                const copy = [...manualDraftOrder];
                                copy[idx] = e.target.value;
                                setManualDraftOrder(copy);
                              }}
                              displayEmpty
                              fullWidth
                            >
                              <MenuItem value="">
                                <em>Unassigned</em>
                              </MenuItem>
                              {playerList.map(p => (
                                <MenuItem key={p} value={p}>
                                  {p}
                                </MenuItem>
                              ))}
                            </Select>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button
                variant="contained"
                sx={{ mt: 2 }}
                onClick={confirmAssignments}
              >
                Confirm & Start Draft
              </Button>
            </Box>
          ) : (
            <Box>
              <Typography variant="h5" gutterBottom>
                Players in Lobby
              </Typography>
              <List>
                {playerList.map(p => (
                  <ListItem key={p}>
                    <ListItemText primary={p} />
                  </ListItem>
                ))}
              </List>
              {playerList.length === 6 && playerList[0] === nickname && (
                <Button variant="contained" onClick={startAssignment}>
                  Start Manual Draft
                </Button>
              )}
            </Box>
          )
        ) : (
          // ─── Live draft ────────────────────────────────────────────
          <Box>
            {draftEnded && (
              <Box mb={2} p={2} bgcolor="success.light" borderRadius={2}>
                <Typography variant="h5" align="center">
                  🎉 Draft Complete! 🎉
                </Typography>
              </Box>
            )}
            <Typography variant="h4" mb={2}>
              Draft Time! (Pick {picks.filter(x => x).length + 1})
            </Typography>

            {/* position filter chips */}
            <Box mb={2}>
              {positions.map(pos => (
                <Chip
                  key={pos}
                  label={pos}
                  clickable
                  color={filterPos === pos ? 'primary' : 'default'}
                  onClick={() => setFilterPos(pos)}
                  sx={{ mr: 1 }}
                />
              ))}
            </Box>

            <Grid container spacing={2}>
              {/* available players panel */}
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, maxHeight: 600, overflowY: 'auto' }}>
                  <Typography variant="h6" gutterBottom>
                    Available {filterPos} Players
                  </Typography>
                  <List>
                    {categorized[filterPos]?.map((p, idx) => {
                      const pickIndex = picks.findIndex(
                        (v, i) => !v && draftOrderSocketIds[i] === socket.id
                      );
                      return (
                        <ListItem key={p['PLAYER NAME']}>
                          <Box
                            display="flex"
                            justifyContent="space-between"
                            alignItems="center"
                            width="100%"
                          >
                            <Box display="flex" alignItems="center">
                              <Chip label={p.POS} size="small" sx={{ mr: 1 }} />
                              <ListItemText
                                primary={`${idx + 1}. ${p['PLAYER NAME']}`}
                                secondary={`${p.POS}, ${p.TEAM}`}
                              />
                            </Box>
                            <Button
                              size="small"
                              variant="outlined"
                              disabled={!isMyTurn || draftEnded || pickIndex === -1}
                              onClick={() => makePick(p, pickIndex)}
                            >
                              Pick
                            </Button>
                          </Box>
                        </ListItem>
                      );
                    })}
                  </List>
                </Paper>
              </Grid>

              {/* draft board table */}
              <Grid item xs={12} md={8}>
                <Paper sx={{ p: 2, overflowX: 'auto' }}>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Round</TableCell>
                        {playerList.map(p => (
                          <TableCell key={p}>{p}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Array.from({ length: numRounds }).map((_, r) => (
                        <TableRow key={r}>
                          <TableCell>
                            <strong>Round {r + 1}</strong>
                          </TableCell>
                          {playerList.map((_, c) => {
                            const idx = r * playerList.length + c;
                            const owner = draftOrderNicknames[idx];
                            return (
                              <TableCell
                                key={`${r}-${c}`}
                                sx={{
                                  backgroundColor: owner ? getColor(owner) : '#fff',
                                  minWidth: 120
                                }}
                              >
                                {picks[idx]?.playerName || '-'}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}
      </Container>
    </ThemeProvider>
  );
}
