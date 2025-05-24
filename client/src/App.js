// App.js
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

const socket = io('https://my-draft-app-production.up.railway.app');
const theme = createTheme({ palette: { mode: 'light' } });

// Total rounds for manual assignment and live draft
const TOTAL_ROUNDS = 2;
// Pastel colors for manager columns
const pastelColors = ['#f8d7da', '#d1ecf1', '#d4edda', '#fff3cd', '#e2dfff', '#f0f0f0'];

function getColorMap(players) {
  const sorted = [...players].sort();
  const map = {};
  sorted.forEach((name, idx) => {
    map[name] = pastelColors[idx % pastelColors.length];
  });
  return map;
}

export default function App() {
  // Lobby state
  const [roomCode, setRoomCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [joined, setJoined] = useState(false);
  const [playerList, setPlayerList] = useState([]);
  const [assigning, setAssigning] = useState(false);
  const [manualDraftOrder, setManualDraftOrder] = useState([]);

  // Draft state
  const [draftStarted, setDraftStarted] = useState(false);
  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [picks, setPicks] = useState([]);
  const [nextPicker, setNextPicker] = useState(null);
  const [draftOrderSocketIds, setDraftOrderSocketIds] = useState([]);
  const [draftOrderNicknames, setDraftOrderNicknames] = useState([]);
  const [draftEnded, setDraftEnded] = useState(false);

  // Filtering UI
  const positions = useMemo(() => ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'], []);
  const [filterPos, setFilterPos] = useState('All');

  // Color map for manager columns
  const colorMap = useMemo(() => getColorMap(playerList), [playerList]);
  const getColor = name => colorMap[name] || '#f7f7f7';

  // Categorize available players by first letter of position
  const categorized = useMemo(() => {
    const all = [...availablePlayers];
    const byPos = { All: all };
    positions.slice(1).forEach(pos => {
      byPos[pos] = all.filter(p => {
        const raw = p.POS ?? p['Pos'] ?? p.Position ?? p['position'] ?? '';
        const firstLetter = raw.toString().charAt(0).toUpperCase();
        return firstLetter === pos.charAt(0);
      });
    });
    return byPos;
  }, [availablePlayers, positions]);

  // Socket.io event handlers
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

    // Listen for join errors once draft started
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

  // Join room
  const joinRoom = () => {
    if (!roomCode || !nickname) return;
    socket.emit('joinRoom', { code: roomCode, nickname });
    setJoined(true);
  };

  // Begin manual assignment
  const startAssignment = () => {
    const totalSlots = playerList.length * TOTAL_ROUNDS;
    setManualDraftOrder(Array(totalSlots).fill(''));
    setAssigning(true);
  };

  // Confirm manual assignments and start draft
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

  // Make a pick
  const makePick = (player, pickIndex) => {
    socket.emit('makePick', {
      code: roomCode,
      playerName: player['PLAYER NAME'],
      pickIndex
    });
  };

  const isMyTurn = nextPicker === socket.id;
  const numRounds = playerList.length ? Math.ceil(picks.length / playerList.length) : 0;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar><Typography variant="h6">Manual Draft Room</Typography></Toolbar>
      </AppBar>
      <Container sx={{ mt: 4 }}>
        {!joined ? (
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
            <Button variant="contained" onClick={joinRoom}>Join</Button>
          </Box>
        ) : !draftStarted ? (
          assigning ? (
            <Box>
              <Typography variant="h5">Assign Each Pick ({TOTAL_ROUNDS} Rounds)</Typography>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Round</TableCell>
                    {playerList.map(manager => <TableCell key={manager}>{manager}</TableCell>)}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Array.from({ length: TOTAL_ROUNDS }).map((_, round) => (
                    <TableRow key={round}>
                      <TableCell>{round + 1}</TableCell>
                      {playerList.map((manager, col) => {
                        const idx = round * playerList.length + col;
                        const sel = manualDraftOrder[idx];
                        const bg = sel ? getColor(sel) : '#fff';
                        return (
                          <TableCell key={manager} sx={{ backgroundColor: bg }}>
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
                              <MenuItem value=""><em>Unassigned</em></MenuItem>
                              {playerList.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                            </Select>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button variant="contained" sx={{ mt: 2 }} onClick={confirmAssignments}>Confirm & Start</Button>
            </Box>
          ) : (
            <Box>
              <Typography variant="h5">Players in Lobby</Typography>
              <List>{playerList.map(p => <ListItem key={p}><ListItemText primary={p} /></ListItem>)}</List>
              {playerList.length === 6 && playerList[0] === nickname && (
                <Button variant="contained" onClick={startAssignment}>Start Manual Draft</Button>
              )}
            </Box>
          )
        ) : (
          <Box>
            {draftEnded && (
              <Box mb={2} p={2} bgcolor="success.light" borderRadius={2}>
                <Typography variant="h5" align="center">🎉 Draft Complete! 🎉</Typography>
              </Box>
            )}
            <Typography variant="h4" mb={2}>Draft Time! (Pick {picks.filter(x => x).length + 1})</Typography>
            <Box mb={2}>{positions.map(pos => (
              <Chip
                key={pos}
                label={pos}
                clickable
                color={filterPos === pos ? 'primary' : 'default'}
                onClick={() => setFilterPos(pos)}
                sx={{ mr: 1 }}
              />
            ))}</Box>
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, maxHeight: 600, overflowY: 'auto' }}>
                  <Typography variant="h6">Available {filterPos} Players</Typography>
                  <List>{categorized[filterPos]?.map((p, idx) => {
                      const pickIndex = picks.findIndex((v, i) => !v && draftOrderSocketIds[i] === socket.id);
                      return (
                        <ListItem key={p['PLAYER NAME']}>
                          <Box display="flex" justifyContent="space-between" alignItems="center" width="100%">
                            <Box display="flex" alignItems="center">
                              <Chip label={p.POS} size="small" sx={{ mr: 1 }} />
                              <ListItemText primary={`${idx + 1}. ${p['PLAYER NAME']}`} secondary={`${p.POS}, ${p.TEAM}`} />
                            </Box>
                            <Button size="small" variant="outlined" disabled={!isMyTurn || draftEnded || pickIndex === -1} onClick={() => makePick(p, pickIndex)}>Pick</Button>
                          </Box>
                        </ListItem>
                      );
                    })}</List>
                </Paper>
              </Grid>
              <Grid item xs={12} md={8}>
                <Paper sx={{ p: 2, overflowX: 'auto' }}>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Round</TableCell>
                        {playerList.map(p => <TableCell key={p}>{p}</TableCell>)}
                      </TableRow>
                    </TableHead>
                    <TableBody>{Array.from({ length: numRounds }).map((_, r) => (
                        <TableRow key={r}>
                          <TableCell><strong>Round {r + 1}</strong></TableCell>
                          {playerList.map((_, c) => {
                            const slotIdx = r * playerList.length + c;
                            const slotOwner = draftOrderNicknames[slotIdx];
                            const bg = slotOwner ? getColor(slotOwner) : '#fff';
                            return (
                              <TableCell key={`${c}-${r}`} sx={{ backgroundColor: bg, minWidth: 120 }}>
                                {picks[slotIdx]?.playerName || '-'}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}</TableBody>
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
