// src/App.js
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

// ——— Socket.IO — force WebSocket transport ———
const socket = io('https://my-draft-app-production.up.railway.app', {
  transports: ['websocket']
});

const theme = createTheme({ palette: { mode: 'light' } });
const TOTAL_ROUNDS = 2;

// pastel colors for lobby cols
const pastelColors = ['#f8d7da','#d1ecf1','#d4edda','#fff3cd','#e2dfff','#f0f0f0'];
function getColorMap(players){
  const sorted = [...players].sort(), map = {};
  sorted.forEach((n,i)=>map[n]=pastelColors[i%pastelColors.length]);
  return map;
}

// position → highlight color
const positionColors = {
  QB:  '#9b59b6',
  RB:  '#3498db',
  WR:  '#e74c3c',
  TE:  '#f1c40f',
  K:   '#2ecc71',
  DST: '#95a5a6'
};

export default function App(){
  // ─── Lobby state ──────────────────────────────────────────
  const [roomCode, setRoomCode]       = useState('');
  const [nickname, setNickname]       = useState('');
  const [joined,    setJoined]        = useState(false);
  const [playerList,setPlayerList]    = useState([]);
  const [assigning, setAssigning]     = useState(false);
  const [manualDraftOrder,setManualDraftOrder] = useState([]);

  // ─── Draft state ──────────────────────────────────────────
  const [draftStarted,     setDraftStarted]     = useState(false);
  const [availablePlayers, setAvailablePlayers] = useState([]);
  // each pick is now { playerName, POS, TEAM, socketId } or null
  const [picks,            setPicks]            = useState([]);
  const [nextPicker,       setNextPicker]       = useState(null);
  const [draftOrderSocketIds, setDraftOrderSocketIds] = useState([]);
  const [draftOrderNicknames, setDraftOrderNicknames] = useState([]);
  const [draftEnded,       setDraftEnded]       = useState(false);

  // position filter
  const positions = useMemo(() => ['All','QB','RB','WR','TE','K','DST'], []);
  const [filterPos, setFilterPos] = useState('All');

  // color map for columns
  const colorMap = useMemo(() => getColorMap(playerList), [playerList]);
  const getColor = name => colorMap[name] || '#f7f7f7';

  // bucket available players by position
  const categorized = useMemo(() => {
    const all = [...availablePlayers], byPos = {All:all};
    positions.slice(1).forEach(pos=>{
      byPos[pos] = all.filter(p => {
        const raw = p.POS ?? p['Pos'] ?? '';
        return raw.charAt(0).toUpperCase() === pos.charAt(0);
      });
    });
    return byPos;
  }, [availablePlayers,positions]);

  // ─── Socket.IO handlers ────────────────────────────────────
  useEffect(()=>{
    socket.on('connect', () => console.log('🟢 socket connected →', socket.id));
    socket.on('connect_error', (err) => console.error('🔴 connection error', err));

    socket.on('updateLobby', list => setPlayerList(list));

    socket.on('draftStarted', ({ draftOrderSocketIds,draftOrderNicknames,playersPool })=>{
      setDraftStarted(true);
      setDraftOrderSocketIds(draftOrderSocketIds);
      setDraftOrderNicknames(draftOrderNicknames);
      setAvailablePlayers(playersPool);
      setPicks(Array(draftOrderSocketIds.length).fill(null));
      setNextPicker(draftOrderSocketIds[0]);
      setDraftEnded(false);
    });

    socket.on('updateDraft', ({ picks,availablePlayers,nextPicker })=>{
      setPicks(picks);
      setAvailablePlayers(availablePlayers);
      setNextPicker(nextPicker);
      setFilterPos('All');    // always reset filter so you see something
    });

    socket.on('draftEnded', () => setDraftEnded(true));
    socket.on('joinError', ({ message }) => { alert(message); setJoined(false); });

    return () => { socket.off(); };
  }, []);

  // ─── Actions ────────────────────────────────────────────────
  const joinRoom = () => {
    if(!roomCode||!nickname) return;
    console.log('➤ joinRoom()', roomCode, nickname);
    socket.emit('joinRoom',
      { code: roomCode.toUpperCase(), nickname },
      ({ success,error })=>{
        console.log('⬅️ joinRoom callback',success,error);
        if(success) setJoined(true);
        else       alert(error);
      }
    );
  };

  const startAssignment = ()=>{
    const total = playerList.length * TOTAL_ROUNDS;
    setManualDraftOrder(Array(total).fill(''));
    setAssigning(true);
  };
  const confirmAssignments = ()=>{
    if(manualDraftOrder.some(p=>!p)){
      return alert('All picks must be assigned!');
    }
    socket.emit('startDraft',{
      code: roomCode,
      draftOrder: manualDraftOrder,
      numRounds: TOTAL_ROUNDS,
      snake: false
    });
  };

  const makePick = (player,pickIndex)=>{
    socket.emit('makePick',{
      code: roomCode,
      playerName: player['PLAYER NAME'],
      pickIndex
    });
  };

  const isMyTurn  = nextPicker === socket.id;
  const numRounds = playerList.length
    ? Math.ceil(picks.length / playerList.length)
    : 0;

  // ─── RENDER ────────────────────────────────────────────────
  return (
    <ThemeProvider theme={theme}>
    <CssBaseline/>
    <AppBar position="static"><Toolbar>
      <Typography variant="h6">Manual Draft Room</Typography>
    </Toolbar></AppBar>
    <Container sx={{mt:4}}>

      {/* not joined / pre‑draft / live draft */}
      {!joined ? (
        <Box display="flex" gap={2} alignItems="center">
          <TextField
            label="Room Code"
            value={roomCode}
            onChange={e=>setRoomCode(e.target.value.toUpperCase())}
          />
          <TextField
            label="Nickname"
            value={nickname}
            onChange={e=>setNickname(e.target.value)}
          />
          <Button variant="contained" onClick={joinRoom}>
            Join
          </Button>
        </Box>
      ) : !draftStarted ? (
        assigning ? (
          <Box>… manual‑assignment UI …</Box>
        ) : (
          <Box>
            <Typography variant="h5" gutterBottom>
              Players in Lobby
            </Typography>
            <List>
              {playerList.map(p=>(
                <ListItem key={p}>
                  <ListItemText primary={p}/>
                </ListItem>
              ))}
            </List>
            {playerList.length===6 && playerList[0]===nickname && (
              <Button variant="contained" onClick={startAssignment}>
                Start Manual Draft
              </Button>
            )}
          </Box>
        )
      ) : (
        /* ─── Live Draft ───────────────────────────────────────── */
        <Box>

          {draftEnded && (
            <Box mb={2} p={2} bgcolor="success.light" borderRadius={2}>
              <Typography variant="h5" align="center">
                🎉 Draft Complete! 🎉
              </Typography>
            </Box>
          )}

          <Typography variant="h4" mb={2}>
            Draft Time! (Pick {picks.filter(x=>x).length+1})
          </Typography>

          {/* position filter */}
          <Box mb={2}>
            {positions.map(pos=>(
              <Chip
                key={pos}
                label={pos}
                clickable
                color={filterPos===pos?'primary':'default'}
                onClick={()=>setFilterPos(pos)}
                sx={{mr:1}}
              />
            ))}
          </Box>

          <Grid container spacing={2}>

            {/* Available Players */}
            <Grid item xs={12} md={4}>
              <Paper sx={{p:2, maxHeight:600, overflowY:'auto'}}>
                <Typography variant="h6" gutterBottom>
                  Available {filterPos} Players
                </Typography>
                <List>
                  {categorized[filterPos]?.map((p,idx)=>{
                    const pickIndex = picks.findIndex(
                      (v,i) => !v && draftOrderSocketIds[i]===socket.id
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
                            <Chip label={p.POS} size="small" sx={{mr:1}}/>
                            <ListItemText
                              primary={`${idx+1}. ${p['PLAYER NAME']}`}
                              secondary={`${p.POS}, ${p.TEAM}`}
                            />
                          </Box>
                          <Button
                            size="small"
                            variant="outlined"
                            disabled={!isMyTurn||draftEnded||pickIndex===-1}
                            onClick={()=>makePick(p,pickIndex)}
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

            {/* Draft Board */}
            <Grid item xs={12} md={8}>
              <Paper sx={{p:2, overflowX:'auto'}}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Round</TableCell>
                      {playerList.map(p=>(
                        <TableCell key={p}>{p}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Array.from({length:numRounds}).map((_,r)=>(
                      <TableRow key={r}>
                        <TableCell>
                          <strong>Round {r+1}</strong>
                        </TableCell>
                        {playerList.map((_,c)=>{
                          const idx = r*playerList.length + c;
                          const pick = picks[idx];
                          const bg = pick
                            ? (positionColors[pick.POS]||'#fff')
                            : '#fff';
                          return (
                            <TableCell
                              key={`${r}-${c}`}
                              sx={{backgroundColor:bg, minWidth:120}}
                            >
                              {pick?.playerName ?? '-'}
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
