const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

// WebSocket server config
const wss = new WebSocket.Server({ 
  server,
  path: '/'
});

// Safe WebSocket send
function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection from:', req.headers.host);
});

// Static files
app.use(express.static(path.join(__dirname, '../public')));

// Room management
const PLAYER_ROLES = ['黑棋', '白棋', '红棋', '蓝棋', '绿棋', '黄棋', '紫棋', '橙棋', '粉棋', '青棋'];
const PLAYER_COLORS = ['#000000', '#FFFFFF', '#FF0000', '#0984e3', '#00b894', '#fdcb6e', '#6c5ce7', '#e17055', '#e84393', '#00cec9'];

// Generate room ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Create room
function createRoom(ws, roomId, playerName) {
  const room = {
    id: roomId,
    players: [],
    board: Array(15).fill(null).map(() => Array(15).fill(0)),
    currentPlayer: 0,
    gameStarted: false,
    winner: null,
    history: [],
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
  
  rooms.set(roomId, room);
  return room;
}

// Join room
function joinRoom(ws, roomId, playerName, colorId = null) {
  const room = rooms.get(roomId);
  if (!room) return { success: false, message: '房间不存在' };
  
  const onlinePlayers = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
  
  if (onlinePlayers.length >= 10) return { success: false, message: '房间已满' };
  if (room.gameStarted) return { success: false, message: '游戏已开始' };
  
  // Check for disconnected player reconnection
  const disconnectedPlayer = room.players.find(p => p.name === playerName && p.ws && p.ws.readyState !== WebSocket.OPEN);
  if (disconnectedPlayer) {
    disconnectedPlayer.ws = ws;
    return { success: true, room, reconnect: true };
  }
  
  // Get taken colors
  const takenColors = room.players.map(p => p.colorId);
  
  // Assign color
  let selectedColorId = colorId;
  if (selectedColorId === null || takenColors.includes(selectedColorId)) {
    for (let i = 0; i < 10; i++) {
      if (!takenColors.includes(i)) {
        selectedColorId = i;
        break;
      }
    }
  }
  
  // Order ID = current player count (0, 1, 2...)
  const orderId = room.players.length;
  
  // Add new player
  room.players.push({
    orderId: orderId,
    colorId: selectedColorId,
    name: playerName,
    color: PLAYER_COLORS[selectedColorId],
    role: PLAYER_ROLES[selectedColorId],
    ws: ws
  });
  
  return { success: true, room };
}

// Broadcast to room
function broadcast(room, message, excludeWs = null) {
  room.players.forEach(player => {
    if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
      safeSend(player.ws, message);
    }
  });
}

// Check win
function checkWin(board, row, col, player) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const size = 15;
  
  for (const [dr, dc] of directions) {
    let count = 1;
    
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r][c] !== player) break;
      count++;
    }
    
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i;
      const c = col - dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r][c] !== player) break;
      count++;
    }
    
    if (count >= 5) return true;
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
        const room = createRoom(ws, roomId, msg.playerName || '玩家1');
        room.lastActivity = Date.now();
        
        const player = {
          orderId: 0,
          colorId: 0,
          name: msg.playerName || '玩家1',
          color: PLAYER_COLORS[0],
          role: PLAYER_ROLES[0],
          ws: ws
        };
        room.players.push(player);
        
        currentRoom = room;
        playerInfo = player;
        
        safeSend(ws, { type: 'created', roomId, orderId: 0, colorId: 0, ownerOrderId: 0 });
        break;
      }
      
      case 'join': {
        const result = joinRoom(ws, msg.roomId, msg.playerName || '玩家' + Date.now() % 1000, msg.colorId);
        if (!result.success) {
          safeSend(ws, { type: 'error', message: result.message });
          return;
        }
        currentRoom = result.room;
        currentRoom.lastActivity = Date.now();
        
        playerInfo = result.room.players.find(p => p.ws === ws);
        
        const ownerOrderId = result.room.players.length > 0 ? result.room.players[0].orderId : null;
        
        safeSend(ws, { 
          type: 'joined', 
          roomId: result.room.id, 
          orderId: playerInfo.orderId,
          colorId: playerInfo.colorId,
          ownerOrderId: ownerOrderId,
          reconnect: result.reconnect || false,
          players: result.room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
        });
        
        broadcast(result.room, {
          type: 'playerJoined',
          players: result.room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
        });
        break;
      }
      
      case 'start': {
        if (!currentRoom || currentRoom.players.length < 2) {
          safeSend(ws, { type: 'error', message: '至少需要2名玩家' });
          return;
        }
        currentRoom.gameStarted = true;
        currentRoom.currentPlayer = 0;
        currentRoom.board = Array(15).fill(null).map(() => Array(15).fill(0));
        currentRoom.history = [];
        currentRoom.winner = null;
        
        broadcast(currentRoom, { 
          type: 'gameStart', 
          currentPlayer: 0,
          players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
        });
        break;
      }
      
      case 'selectColor': {
        if (!currentRoom || currentRoom.gameStarted) return;
        
        const newColorId = msg.colorId;
        const takenColors = currentRoom.players.filter(p => p.orderId !== msg.orderId).map(p => p.colorId);
        
        if (takenColors.includes(newColorId)) {
          safeSend(ws, { type: 'error', message: '该颜色已被占用' });
          return;
        }
        
        const player = currentRoom.players.find(p => p.orderId === msg.orderId);
        if (player) {
          player.colorId = newColorId;
          player.color = PLAYER_COLORS[newColorId];
          player.role = PLAYER_ROLES[newColorId];
          
          broadcast(currentRoom, {
            type: 'colorChanged',
            players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
          });
        }
        break;
      }
      
      case 'move': {
        if (!currentRoom || !currentRoom.gameStarted) return;
        if (currentRoom.currentPlayer !== msg.orderId) return;
        
        const { row, col } = msg;
        if (row < 0 || row >= 15 || col < 0 || col >= 15) return;
        if (currentRoom.board[row][col] !== 0) return;
        
        const currentPlayer = currentRoom.players.find(p => p.orderId === msg.orderId);
        if (!currentPlayer) return;
        
        // Place piece (store colorId + 1)
        currentRoom.board[row][col] = currentPlayer.colorId + 1;
        currentRoom.history.push({ row, col, player: msg.orderId, colorId: currentPlayer.colorId, timestamp: Date.now() });
        currentRoom.lastActivity = Date.now();
        
        const isWin = checkWin(currentRoom.board, row, col, currentPlayer.colorId + 1);
        
        const moveData = { type: 'move', row, col, orderId: msg.orderId, colorId: currentPlayer.colorId };
        
        if (isWin) {
          currentRoom.winner = msg.orderId;
          moveData.winner = msg.orderId;
          moveData.gameOver = true;
        } else {
          currentRoom.currentPlayer = (currentRoom.currentPlayer + 1) % currentRoom.players.length;
          moveData.currentPlayer = currentRoom.currentPlayer;
        }
        
        broadcast(currentRoom, moveData);
        break;
      }
      
      case 'restart': {
        if (!currentRoom || currentRoom.players.length < 2) return;
        currentRoom.gameStarted = false;
        currentRoom.board = Array(15).fill(null).map(() => Array(15).fill(0));
        currentRoom.history = [];
        currentRoom.winner = null;
        currentRoom.currentPlayer = 0;
        
        broadcast(currentRoom, { type: 'restart' });
        break;
      }
      
      case 'chat': {
        if (!currentRoom || !playerInfo) return;
        broadcast(currentRoom, {
          type: 'chat',
          orderId: playerInfo.orderId,
          colorId: playerInfo.colorId,
          playerName: playerInfo.name,
          message: msg.message
        });
        break;
      }
      
      case 'getRooms': {
        const roomList = [];
        rooms.forEach((room, id) => {
          if (!room.gameStarted) {
            roomList.push({ id, playerCount: room.players.length });
          }
        });
        safeSend(ws, { type: 'rooms', rooms: roomList });
        break;
      }
      
      case 'leave': {
        if (currentRoom) {
          const playerIndex = currentRoom.players.findIndex(p => p.ws === ws);
          if (playerIndex !== -1) {
            const playerName = currentRoom.players[playerIndex].name;
            
            currentRoom.players.splice(playerIndex, 1);
            
            if (currentRoom.players.length === 0) {
              rooms.delete(currentRoom.id);
            } else {
              broadcast(currentRoom, {
                type: 'playerLeft',
                playerName: playerName,
                players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
              });
            }
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      const playerIndex = currentRoom.players.findIndex(p => p.ws === ws);
      if (playerIndex !== -1) {
        const playerName = currentRoom.players[playerIndex].name;
        const wasGameStarted = currentRoom.gameStarted;
        
        currentRoom.players.splice(playerIndex, 1);
        
        if (currentRoom.players.length === 0) {
          rooms.delete(currentRoom.id);
        } else {
          broadcast(currentRoom, {
            type: 'playerLeft',
            playerName: playerName,
            players: currentRoom.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
          });
          
          if (wasGameStarted && currentRoom.gameStarted) {
            currentRoom.gameStarted = false;
            currentRoom.winner = null;
            broadcast(currentRoom, {
              type: 'gameEnd',
              reason: playerName + ' 离开了游戏'
            });
          }
        }
      }
    }
  });
});

// Clean up idle rooms every 5 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  rooms.forEach((room, roomId) => {
    if (room.players.length === 0) {
      rooms.delete(roomId);
      cleaned++;
      return;
    }
    
    const lastActivity = room.history.length > 0 
      ? Math.max(...room.history.map(h => h.timestamp || 0))
      : room.createdAt || now;
    
    if (now - lastActivity > 30 * 60 * 1000) {
      rooms.delete(roomId);
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log(`Cleaned ${cleaned} idle rooms, ${rooms.size} remaining`);
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
