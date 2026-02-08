const express = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/' });

function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, message, excludeWs = null) {
  room.players.forEach(player => {
    if (player.ws && player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
      safeSend(player.ws, message);
    }
  });
}

wss.on('connection', (ws, req) => {
  console.log('New connection:', req.headers.host);
});

app.use(express.static(path.join(__dirname, '../public')));

// 游戏配置
const GAME_CONFIGS = {
  gomoku: {
    name: '多人五子棋',
    boardSize: 15,
    winCount: 5,
    colors: 2,
    minPlayers: 2
  },
  go: {
    name: '三人围棋',
    boardSize: 9,
    winCount: null, // 提子得分制
    colors: 3,
    minPlayers: 2,
    winningScore: 20
  }
};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 五子棋提子检查
function checkGomokuCaptures(board, row, col, playerColor) {
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const captured = [];
  
  for (const [dr, dc] of directions) {
    const r = row + dr, c = col + dc;
    if (r >= 0 && r < 15 && c >= 0 && c < 15) {
      const neighborColor = board[r][c];
      if (neighborColor !== 0 && neighborColor !== playerColor) {
        const group = getGomokuGroup(board, r, c, new Set());
        if (group.length > 0) {
          const liberties = countGomokuLiberties(board, group);
          if (liberties === 0) {
            for (const [gr, gc] of group) {
              if (!captured.some(p => p.r === gr && p.c === gc)) {
                captured.push({ r: gr, c: gc, color: board[gr][gc] });
              }
            }
          }
        }
      }
    }
  }
  return captured;
}

function getGomokuGroup(board, row, col, visited) {
  const key = `${row},${col}`;
  if (visited.has(key)) return [];
  visited.add(key);
  const color = board[row][col];
  if (color === 0) return [];
  const group = [[row, col]];
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of directions) {
    const r = row + dr, c = col + dc;
    if (r >= 0 && r < 15 && c >= 0 && c < 15) {
      if (board[r][c] === color && !visited.has(`${r},${c}`)) {
        group.push(...getGomokuGroup(board, r, c, visited));
      }
    }
  }
  return group;
}

function countGomokuLiberties(board, group) {
  const liberties = new Set();
  for (const [r, c] of group) {
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of directions) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 15 && nc >= 0 && nc < 15 && board[nr][nc] === 0) {
        liberties.add(`${nr},${nc}`);
      }
    }
  }
  return liberties.size;
}

function hasValidMovesGomoku(board, playerColor) {
  for (let i = 0; i < 15; i++) {
    for (let j = 0; j < 15; j++) {
      if (board[i][j] === 0) {
        // 模拟落子检查是否被提
        const tempBoard = board.map(r => [...r]);
        tempBoard[i][j] = playerColor;
        const captured = checkGomokuCaptures(tempBoard, i, j, playerColor);
        if (captured.length > 0) return true;
        // 检查是否成五
        if (checkWin(tempBoard, playerColor)) return true;
      }
    }
  }
  return false;
}

function checkWin(board, playerColor) {
  const directions = [[1, 1], [1, 0], [1, -1], [0, 1]];
  for (let i = 0; i < 15; i++) {
    for (let j = 0; j < 15; j++) {
      if (board[i][j] === playerColor) {
        for (const [dr, dc] of directions) {
          let count = 1;
          for (let k = 1; k < 5; k++) {
            const r = i + dr * k, c = j + dc * k;
            if (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r][c] === playerColor) {
              count++;
            } else break;
          }
          if (count >= 5) return true;
        }
      }
    }
  }
  return false;
}

// 围棋提子检查
function getGoGroupLiberties(board, row, col, visited = new Set()) {
  const key = `${row},${col}`;
  if (visited.has(key)) return 0;
  visited.add(key);
  const color = board[row][col];
  if (color === 0) return 1;
  let liberties = 0;
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of directions) {
    const r = row + dr, c = col + dc;
    if (r >= 0 && r < 9 && c >= 0 && c < 9) {
      const neighborColor = board[r][c];
      if (neighborColor === 0) {
        liberties++;
      } else if (neighborColor === color && !visited.has(`${r},${c}`)) {
        liberties += getGoGroupLiberties(board, r, c, visited);
      }
    }
  }
  return liberties;
}

function checkGoCaptures(board, row, col, playerColor) {
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const captured = [];
  for (const [dr, dc] of directions) {
    const r = row + dr, c = col + dc;
    if (r >= 0 && r < 9 && c >= 0 && c < 9) {
      const neighborColor = board[r][c];
      if (neighborColor !== 0 && neighborColor !== playerColor) {
        const groupLiberties = getGoGroupLiberties(board, r, c);
        if (groupLiberties === 0) {
          const group = getGoGroup(board, r, c, new Set());
          for (const [gr, gc] of group) {
            if (!captured.some(p => p.r === gr && p.c === gc)) {
              captured.push({ r: gr, c: gc, color: board[gr][gc] });
            }
          }
        }
      }
    }
  }
  return captured;
}

function getGoGroup(board, row, col, visited) {
  const key = `${row},${col}`;
  if (visited.has(key)) return [];
  visited.add(key);
  const color = board[row][col];
  if (color === 0) return [];
  const group = [[row, col]];
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of directions) {
    const r = row + dr, c = col + dc;
    if (r >= 0 && r < 9 && c >= 0 && c < 9) {
      if (board[r][c] === color && !visited.has(`${r},${c}`)) {
        group.push(...getGoGroup(board, r, c, visited));
      }
    }
  }
  return group;
}

function canPlaceGo(board, row, col, playerColor) {
  if (board[row][col] !== 0) return false;
  const tempBoard = board.map(r => [...r]);
  tempBoard[row][col] = playerColor;
  return getGoGroupLiberties(tempBoard, row, col) > 0;
}

function hasValidMovesGo(board, playerColor) {
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      if (board[i][j] === 0 && canPlaceGo(board, i, j, playerColor)) return true;
    }
  }
  return false;
}

const rooms = new Map();

wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerInfo = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    switch (msg.type) {
      case 'create': {
        const roomId = generateRoomId();
        const config = GAME_CONFIGS[msg.gameMode] || GAME_CONFIGS.gomoku;
        const room = {
          id: roomId,
          gameMode: msg.gameMode || 'gomoku',
          players: [],
          board: Array(config.boardSize).fill(null).map(() => Array(config.boardSize).fill(0)),
          currentPlayer: 0,
          gameStarted: false,
          winner: null,
          waitingReconnect: false,
          pendingOfflineOrderId: null,
          scores: Array(config.colors).fill(0),
          createdAt: Date.now(),
          lastActivity: Date.now()
        };
        
        const player = {
          orderId: 0,
          colorId: 0,
          name: msg.playerName || '玩家1',
          color: config.boardSize === 15 ? ['#000000', '#FFFFFF'][0] : ['#000000', '#FFFFFF', '#FF0000'][0],
          role: config.boardSize === 15 ? ['黑棋', '白棋'][0] : ['黑棋', '白棋', '红棋'][0],
          ws: ws,
          isOwner: true,
          score: 0
        };
        
        room.players.push(player);
        room.scores[0] = 0;
        rooms.set(roomId, room);
        
        currentRoom = room;
        playerInfo = player;
        
        safeSend(ws, { 
          type: 'created', 
          roomId, 
          gameMode: room.gameMode,
          orderId: 0, 
          colorId: 0, 
          ownerOrderId: 0,
          players: [{ orderId: 0, colorId: 0, name: msg.playerName || '玩家1', role: player.role, color: player.color, score: 0 }],
          scores: room.scores,
          config: { boardSize: config.boardSize, colors: config.colors, winningScore: config.winningScore }
        });
        break;
      }
      
      case 'join': {
        const room = rooms.get(msg.roomId);
        if (!room) {
          safeSend(ws, { type: 'error', message: '房间不存在' });
          return;
        }
        
        if (room.gameStarted) {
          const offlinePlayer = room.players.find(p => (!p.ws || p.ws.readyState !== WebSocket.OPEN) && p.name === msg.playerName);
          if (offlinePlayer) {
            offlinePlayer.ws = ws;
            currentRoom = room;
            playerInfo = offlinePlayer;
            
            const config = GAME_CONFIGS[room.gameMode];
            safeSend(ws, { 
              type: 'rejoined', 
              roomId: room.id,
              gameMode: room.gameMode,
              orderId: offlinePlayer.orderId,
              colorId: offlinePlayer.colorId,
              board: room.board,
              currentPlayer: room.currentPlayer,
              scores: room.scores,
              ownerOrderId: room.players.find(p => p.isOwner)?.orderId ?? 0,
              players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, score: p.score ?? 0, online: p.ws && p.ws.readyState === WebSocket.OPEN })),
              config: { boardSize: config.boardSize, colors: config.colors, winningScore: config.winningScore }
            });
            
            broadcast(room, {
              type: 'playerReconnected',
              playerName: offlinePlayer.name,
              ownerOrderId: room.players.find(p => p.isOwner)?.orderId ?? 0,
              players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, score: p.score ?? 0, online: p.ws && p.ws.readyState === WebSocket.OPEN }))
            }, ws);
          } else {
            safeSend(ws, { type: 'error', message: '游戏已开始，无法加入' });
          }
          return;
        }
        
        const config = GAME_CONFIGS[room.gameMode];
        if (room.players.length >= config.colors) {
          safeSend(ws, { type: 'error', message: '房间已满' });
          return;
        }
        
        const existingPlayer = room.players.find(p => p.name === msg.playerName && (!p.ws || p.ws.readyState !== WebSocket.OPEN));
        if (existingPlayer) {
          existingPlayer.ws = ws;
          currentRoom = room;
          playerInfo = existingPlayer;
          
          safeSend(ws, { 
            type: 'rejoined', 
            roomId: room.id,
            gameMode: room.gameMode,
            orderId: existingPlayer.orderId,
            colorId: existingPlayer.colorId,
            board: room.board,
            currentPlayer: room.currentPlayer,
            scores: room.scores,
            ownerOrderId: room.players.find(p => p.isOwner)?.orderId ?? 0,
            players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, score: p.score ?? 0 })),
            config: { boardSize: config.boardSize, colors: config.colors, winningScore: config.winningScore }
          });
          return;
        }
        
        const takenColors = room.players.map(p => p.colorId);
        let selectedColorId = msg.colorId;
        if (selectedColorId === null || selectedColorId === undefined || takenColors.includes(selectedColorId)) {
          for (let i = 0; i < config.colors; i++) {
            if (!takenColors.includes(i)) {
              selectedColorId = i;
              break;
            }
          }
        }
        
        const orderId = room.players.length;
        const player = {
          orderId: orderId,
          colorId: selectedColorId,
          name: msg.playerName || '玩家' + Date.now() % 1000,
          color: config.boardSize === 15 ? ['#000000', '#FFFFFF'][selectedColorId] : ['#000000', '#FFFFFF', '#FF0000'][selectedColorId],
          role: config.boardSize === 15 ? ['黑棋', '白棋'][selectedColorId] : ['黑棋', '白棋', '红棋'][selectedColorId],
          ws: ws,
          isOwner: false,
          score: 0
        };
        room.players.push(player);
        room.scores[orderId] = 0;
        
        currentRoom = room;
        playerInfo = player;
        
        safeSend(ws, { 
          type: 'joined', 
          roomId: room.id, 
          gameMode: room.gameMode,
          orderId: player.orderId,
          colorId: player.colorId,
          ownerOrderId: room.players.find(p => p.isOwner)?.orderId ?? 0,
          players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, score: p.score ?? 0 })),
          scores: room.scores,
          config: { boardSize: config.boardSize, colors: config.colors, winningScore: config.winningScore }
        });
        
        broadcast(room, {
          type: 'playerJoined',
          players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, score: p.score ?? 0 }))
        }, ws);
        break;
      }
      
      case 'start': {
        if (!currentRoom) return;
        const config = GAME_CONFIGS[currentRoom.gameMode];
        if (currentRoom.players.length < config.minPlayers) {
          safeSend(ws, { type: 'error', message: '至少需要' + config.minPlayers + '名玩家' });
          return;
        }
        const firstPlayer = currentRoom.players[0];
        currentRoom.currentPlayer = firstPlayer?.orderId ?? 0;
        currentRoom.gameStarted = true;
        currentRoom.board = Array(config.boardSize).fill(null).map(() => Array(config.boardSize).fill(0));
        currentRoom.winner = null;
        currentRoom.waitingReconnect = false;
        currentRoom.pendingOfflineOrderId = null;
        currentRoom.scores = Array(config.colors).fill(0);
        currentRoom.players.forEach(p => p.score = 0);
        
        broadcast(currentRoom, { 
          type: 'gameStart', 
          currentPlayer: currentRoom.currentPlayer,
          ownerOrderId: currentRoom.players.find(p => p.isOwner)?.orderId ?? 0,
          players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, score: p.score ?? 0 })),
          scores: currentRoom.scores,
          config: { boardSize: config.boardSize, colors: config.colors, winningScore: config.winningScore }
        });
        break;
      }
      
      case 'selectColor': {
        if (!currentRoom || currentRoom.gameStarted) return;
        const config = GAME_CONFIGS[currentRoom.gameMode];
        const newColorId = msg.colorId;
        const takenColors = currentRoom.players.filter(p => p.orderId !== msg.orderId).map(p => p.colorId);
        if (takenColors.includes(newColorId)) {
          safeSend(ws, { type: 'error', message: '该颜色已被占用' });
          return;
        }
        const player = currentRoom.players.find(p => p.orderId === msg.orderId);
        if (player) {
          player.colorId = newColorId;
          player.color = config.boardSize === 15 ? ['#000000', '#FFFFFF'][newColorId] : ['#000000', '#FFFFFF', '#FF0000'][newColorId];
          player.role = config.boardSize === 15 ? ['黑棋', '白棋'][newColorId] : ['黑棋', '白棋', '红棋'][newColorId];
          broadcast(currentRoom, { type: 'colorChanged', players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, score: p.score ?? 0 })) });
        }
        break;
      }
      
      case 'move': {
        if (!currentRoom || !currentRoom.gameStarted) return;
        if (currentRoom.waitingReconnect) return;
        const currentPlayer = currentRoom.players.find(p => p.orderId === msg.orderId);
        if (!currentPlayer) return;
        if (currentRoom.currentPlayer !== msg.orderId) return;
        
        const { row, col } = msg;
        const config = GAME_CONFIGS[currentRoom.gameMode];
        if (row < 0 || row >= config.boardSize || col < 0 || col >= config.boardSize) return;
        if (currentRoom.board[row][col] !== 0) return;
        
        const playerColor = currentPlayer.colorId + 1;
        let captured = [], scoreGained = 0, gameOver = false, noValidMoves = false;
        
        if (currentRoom.gameMode === 'gomoku') {
          currentRoom.board[row][col] = playerColor;
          captured = checkGomokuCaptures(currentRoom.board, row, col, playerColor);
          if (captured.length > 0) {
            for (const cap of captured) {
              currentRoom.board[cap.r][cap.c] = 0;
              scoreGained++;
            }
          }
          if (currentPlayer.score !== undefined) currentPlayer.score += scoreGained;
          currentRoom.scores[currentPlayer.orderId] = currentPlayer.score ?? 0;
          if (checkWin(currentRoom.board, playerColor)) {
            gameOver = true;
            currentRoom.winner = msg.orderId;
          } else if (!hasValidMovesGomoku(currentRoom.board, playerColor)) {
            noValidMoves = true;
          } else {
            const currentIdx = currentRoom.players.findIndex(p => p.orderId === msg.orderId);
            const nextIdx = (currentIdx + 1) % currentRoom.players.length;
            currentRoom.currentPlayer = currentRoom.players[nextIdx].orderId;
          }
        } else {
          if (!canPlaceGo(currentRoom.board, row, col, playerColor)) {
            safeSend(ws, { type: 'error', message: '此处不能落子（无气）' });
            return;
          }
          currentRoom.board[row][col] = playerColor;
          captured = checkGoCaptures(currentRoom.board, row, col, playerColor);
          if (captured.length > 0) {
            for (const cap of captured) {
              currentRoom.board[cap.r][cap.c] = 0;
              scoreGained++;
            }
          }
          if (currentPlayer.score !== undefined) currentPlayer.score += scoreGained;
          currentRoom.scores[currentPlayer.orderId] = currentPlayer.score ?? 0;
          if (currentPlayer.score >= (config.winningScore || 20)) {
            gameOver = true;
            currentRoom.winner = msg.orderId;
          } else if (!hasValidMovesGo(currentRoom.board, playerColor)) {
            noValidMoves = true;
          } else {
            const currentIdx = currentRoom.players.findIndex(p => p.orderId === msg.orderId);
            const nextIdx = (currentIdx + 1) % currentRoom.players.length;
            currentRoom.currentPlayer = currentRoom.players[nextIdx].orderId;
          }
        }
        
        currentRoom.lastActivity = Date.now();
        const moveData = { type: 'move', row, col, orderId: msg.orderId, colorId: currentPlayer.colorId, captured, scoreGained, scores: currentRoom.scores, gameOver };
        
        if (!gameOver) {
          if (noValidMoves) {
            moveData.noValidMoves = true;
            moveData.currentPlayer = currentRoom.currentPlayer;
          } else {
            moveData.currentPlayer = currentRoom.currentPlayer;
          }
        }
        broadcast(currentRoom, moveData);
        break;
      }
      
      case 'pass': {
        if (!currentRoom || !currentRoom.gameStarted) return;
        const currentPlayer = currentRoom.players.find(p => p.orderId === msg.orderId);
        if (!currentPlayer || currentRoom.currentPlayer !== msg.orderId) return;
        const currentIdx = currentRoom.players.findIndex(p => p.orderId === msg.orderId);
        const nextIdx = (currentIdx + 1) % currentRoom.players.length;
        currentRoom.currentPlayer = currentRoom.players[nextIdx].orderId;
        broadcast(currentRoom, { type: 'pass', orderId: msg.orderId, playerName: currentPlayer.name, currentPlayer: currentRoom.currentPlayer });
        break;
      }
      
      case 'ownerDecision': {
        if (!currentRoom || !currentRoom.waitingReconnect) return;
        const offlineOrderId = currentRoom.pendingOfflineOrderId;
        const offlinePlayer = currentRoom.players.find(p => p.orderId === offlineOrderId);
        if (msg.continueWaiting) {
          currentRoom.waitingReconnect = false;
          currentRoom.pendingOfflineOrderId = null;
          broadcast(currentRoom, { type: 'gameResumed', message: '继续等待 ' + (offlinePlayer?.name ?? '玩家') + ' 重连...' });
        } else {
          if (offlinePlayer) {
            currentRoom.players = currentRoom.players.filter(p => p.orderId !== offlineOrderId);
            currentRoom.waitingReconnect = false;
            currentRoom.pendingOfflineOrderId = null;
            if (currentRoom.players.length > 0) {
              const currentIdx = currentRoom.players.findIndex(p => p.orderId === currentRoom.currentPlayer);
              if (currentIdx === -1 || currentIdx >= currentRoom.players.length) {
                currentRoom.currentPlayer = currentRoom.players[0]?.orderId ?? 0;
              }
              broadcast(currentRoom, { type: 'playerRemoved', playerName: offlinePlayer.name, waitingReconnect: false, players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, score: p.score ?? 0 })), currentPlayer: currentRoom.currentPlayer, ownerOrderId: currentRoom.players.find(p => p.isOwner)?.orderId ?? 0 });
            }
          }
        }
        currentRoom.lastActivity = Date.now();
        break;
      }
      
      case 'chat': {
        if (!currentRoom || !playerInfo) return;
        broadcast(currentRoom, { type: 'chat', orderId: playerInfo.orderId, colorId: playerInfo.colorId, playerName: playerInfo.name, message: msg.message });
        break;
      }
      
      case 'restart': {
        if (!currentRoom) return;
        const player = currentRoom.players.find(p => p.ws === ws);
        if (!player || !player.isOwner) {
          safeSend(ws, { type: 'error', message: '只有房主可以发起再来一局' });
          return;
        }
        const config = GAME_CONFIGS[currentRoom.gameMode];
        currentRoom.gameStarted = true;
        currentRoom.currentPlayer = currentRoom.players[0]?.orderId ?? 0;
        currentRoom.board = Array(config.boardSize).fill(null).map(() => Array(config.boardSize).fill(0));
        currentRoom.winner = null;
        currentRoom.waitingReconnect = false;
        currentRoom.pendingOfflineOrderId = null;
        currentRoom.scores = Array(config.colors).fill(0);
        currentRoom.players.forEach(p => p.score = 0);
        broadcast(currentRoom, { type: 'restart' });
        break;
      }
      
      case 'getRooms': {
        const roomList = [];
        rooms.forEach((room, id) => {
          if (!room.gameStarted && room.players.length > 0) {
            roomList.push({ id, playerCount: room.players.length, gameMode: room.gameMode });
          }
        });
        safeSend(ws, { type: 'rooms', rooms: roomList });
        break;
      }
      
      case 'leave': {
        if (!currentRoom) break;
        const player = currentRoom.players.find(p => p.ws === ws);
        if (!player) break;
        const wasOwner = player.isOwner;
        const playerName = player.name;
        player.ws = null;
        
        if (currentRoom.gameStarted) {
          broadcast(currentRoom, { type: 'playerOffline', playerName, orderId: player.orderId });
          currentRoom.waitingReconnect = true;
          currentRoom.pendingOfflineOrderId = player.orderId;
          currentRoom.lastActivity = Date.now();
          if (wasOwner) {
            player.isOwner = false;
            const onlinePlayers = currentRoom.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
            if (onlinePlayers.length > 0) {
              onlinePlayers.forEach(p => p.isOwner = false);
              onlinePlayers[0].isOwner = true;
              broadcast(currentRoom, { type: 'ownerChanged', newOwnerOrderId: onlinePlayers[0].orderId, newOwnerName: onlinePlayers[0].name, offlinePlayerName: playerName, offlineOrderId: player.orderId });
            }
          }
        } else {
          if (wasOwner) {
            broadcast(currentRoom, { type: 'roomDismissed', message: '房主已离开，房间解散' });
            rooms.delete(currentRoom.id);
            currentRoom = null;
            playerInfo = null;
            return;
          }
          const idx = currentRoom.players.indexOf(player);
          if (idx > -1) {
            currentRoom.players.splice(idx, 1);
            broadcast(currentRoom, { type: 'playerLeft', playerName, players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, score: p.score ?? 0 })) });
          }
        }
        currentRoom = null;
        playerInfo = null;
        break;
      }
    }
  });

  ws.on('close', () => {
    return;
  });
});

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  rooms.forEach((room, roomId) => {
    if (room.players.length === 0) {
      rooms.delete(roomId);
      cleaned++;
      return;
    }
    if (room.gameStarted) {
      const onlineCount = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN).length;
      if (onlineCount === 0) {
        rooms.delete(roomId);
        cleaned++;
        return;
      }
      if (room.waitingReconnect && now - room.lastActivity > 5 * 60 * 1000) {
        const offlineOrderId = room.pendingOfflineOrderId;
        room.players = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
        room.waitingReconnect = false;
        room.pendingOfflineOrderId = null;
        if (room.players.length > 0) {
          const currentIdx = room.players.findIndex(p => p.orderId === room.currentPlayer);
          if (currentIdx === -1 || currentIdx >= room.players.length) {
            room.currentPlayer = room.players[0]?.orderId ?? 0;
          }
          broadcast(room, { type: 'playerRemoved', playerName: '离线玩家', waitingReconnect: false, players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color, score: p.score ?? 0 })), currentPlayer: room.currentPlayer, ownerOrderId: room.players.find(p => p.isOwner)?.orderId ?? 0 });
        } else {
          rooms.delete(roomId);
        }
        cleaned++;
      }
    }
  });
  if (cleaned > 0) console.log('Cleaned ' + cleaned + ' rooms');
}, 3 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});
