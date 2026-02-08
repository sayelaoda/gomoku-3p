const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

// WebSocket服务器配置
const wss = new WebSocket.Server({ 
  server,
  path: '/'
});

// 处理WebSocket升级
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection from:', req.headers.host);
});

// 静态文件服务
app.use(express.static(path.join(__dirname, '../public')));

// 房间管理
const rooms = new Map();
const PLAYERS = ['黑棋', '白棋', '红棋'];
const COLORS = ['#000000', '#FFFFFF', '#FF0000'];

// 生成房间ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 创建房间
function createRoom(ws, roomId, playerName) {
  const room = {
    id: roomId,
    players: [],
    board: Array(15).fill(null).map(() => Array(15).fill(0)),
    currentPlayer: 0, // 0:黑棋, 1:白棋, 2:红棋
    gameStarted: false,
    winner: null,
    history: [] // 记录每步棋
  };
  
  rooms.set(roomId, room);
  return room;
}

// 加入房间
function joinRoom(ws, roomId, playerName) {
  const room = rooms.get(roomId);
  if (!room) return { success: false, message: '房间不存在' };
  if (room.players.length >= 3) return { success: false, message: '房间已满' };
  if (room.gameStarted) return { success: false, message: '游戏已开始' };
  
  const playerIndex = room.players.length;
  room.players.push({
    id: playerIndex,
    name: playerName,
    color: COLORS[playerIndex],
    role: PLAYERS[playerIndex],
    ws: ws
  });
  
  return { success: true, room };
}

// 广播消息给房间内所有玩家
function broadcast(room, message, excludeWs = null) {
  room.players.forEach(player => {
    if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(JSON.stringify(message));
    }
  });
}

// 检查获胜
function checkWin(board, row, col, player) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const size = 15;
  
  for (const [dr, dc] of directions) {
    let count = 1;
    
    // 正方向
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r][c] !== player) break;
      count++;
    }
    
    // 反方向
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

// WebSocket处理
wss.on('connection', (ws) => {
  let currentRoom = null;
  let playerInfo = null;

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    
    switch (msg.type) {
      case 'create': {
        // 创建房间
        const roomId = generateRoomId();
        const room = createRoom(ws, roomId, msg.playerName || '玩家1');
        
        // 添加房主到房间
        const player = {
          id: 0,
          name: msg.playerName || '玩家1',
          color: COLORS[0],
          role: PLAYERS[0],
          ws: ws
        };
        room.players.push(player);
        
        currentRoom = room;
        playerInfo = player;
        
        ws.send(JSON.stringify({ type: 'created', roomId, playerId: 0 }));
        break;
      }
      
      case 'join': {
        // 加入房间
        const result = joinRoom(ws, msg.roomId, msg.playerName || `玩家${Date.now() % 1000}`);
        if (!result.success) {
          ws.send(JSON.stringify({ type: 'error', message: result.message }));
          return;
        }
        currentRoom = result.room;
        playerInfo = result.room.players[result.room.players.length - 1];
        ws.send(JSON.stringify({ 
          type: 'joined', 
          roomId: result.room.id, 
          playerId: playerInfo.id,
          players: result.room.players.map(p => ({ id: p.id, name: p.name, role: p.role }))
        }));
        
        // 通知其他玩家
        broadcast(result.room, {
          type: 'playerJoined',
          players: result.room.players.map(p => ({ id: p.id, name: p.name, role: p.role }))
        });
        break;
      }
      
      case 'start': {
        // 开始游戏
        if (!currentRoom || currentRoom.players.length < 2) {
          ws.send(JSON.stringify({ type: 'error', message: '至少需要2名玩家' }));
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
          players: currentRoom.players.map(p => ({ id: p.id, name: p.name, role: p.role }))
        });
        break;
      }
      
      case 'move': {
        // 下棋
        if (!currentRoom || !currentRoom.gameStarted) return;
        if (currentRoom.currentPlayer !== msg.playerId) return;
        
        const { row, col } = msg;
        if (row < 0 || row >= 15 || col < 0 || col >= 15) return;
        if (currentRoom.board[row][col] !== 0) return;
        
        // 放置棋子
        currentRoom.board[row][col] = msg.playerId + 1; // 1:黑, 2:白, 3:红
        currentRoom.history.push({ row, col, player: msg.playerId });
        
        // 检查获胜
        const isWin = checkWin(currentRoom.board, row, col, msg.playerId + 1);
        
        const moveData = { type: 'move', row, col, playerId: msg.playerId };
        
        if (isWin) {
          currentRoom.winner = msg.playerId;
          moveData.winner = msg.playerId;
          moveData.gameOver = true;
        } else {
          // 切换玩家
          currentRoom.currentPlayer = (currentRoom.currentPlayer + 1) % currentRoom.players.length;
          moveData.currentPlayer = currentRoom.currentPlayer;
        }
        
        broadcast(currentRoom, moveData);
        break;
      }
      
      case 'restart': {
        // 重新开始
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
        // 聊天
        if (!currentRoom || !playerInfo) return;
        broadcast(currentRoom, {
          type: 'chat',
          playerId: playerInfo.id,
          playerName: playerInfo.name,
          message: msg.message
        });
        break;
      }
      
      case 'getRooms': {
        // 获取房间列表
        const roomList = [];
        rooms.forEach((room, id) => {
          if (!room.gameStarted) {
            roomList.push({ id, playerCount: room.players.length });
          }
        });
        ws.send(JSON.stringify({ type: 'rooms', rooms: roomList }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      const playerIndex = currentRoom.players.findIndex(p => p.ws === ws);
      if (playerIndex !== -1) {
        currentRoom.players[playerIndex].ws = null;
        
        // 通知其他玩家
        broadcast(currentRoom, {
          type: 'playerLeft',
          playerId: playerIndex
        });
        
        // 如果没有玩家了，删除房间
        if (currentRoom.players.every(p => p.ws === null)) {
          rooms.delete(currentRoom.id);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 三人五子棋服务器运行在 http://localhost:${PORT}`);
});
