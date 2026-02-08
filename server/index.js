const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: '/' });

function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
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

const PLAYER_ROLES = ['黑棋', '白棋', '红棋', '蓝棋', '绿棋', '黄棋', '紫棋', '橙棋', '粉棋', '青棋'];
const PLAYER_COLORS = ['#000000', '#FFFFFF', '#FF0000', '#0984e3', '#00b894', '#fdcb6e', '#6c5ce7', '#e17055', '#e84393', '#00cec9'];

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function checkWin(board, row, col, player) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const size = 15;
  
  for (const [dr, dc] of directions) {
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i, c = col + dc * i;
      if (r < 0 || r >= size || c < 0 || c >= size || board[r][c] !== player) break;
      count++;
    }
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i, c = col - dc * i;
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
        const room = {
          id: roomId,
          players: [],
          board: Array(15).fill(null).map(() => Array(15).fill(0)),
          currentPlayer: 0,
          gameStarted: false,
          winner: null,
          history: [],
          waitingReconnect: false,  // 等待重连模式
          createdAt: Date.now(),
          lastActivity: Date.now()
        };
        rooms.set(roomId, room);
        
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
        
        safeSend(ws, { 
          type: 'created', 
          roomId, 
          orderId: 0, 
          colorId: 0, 
          ownerOrderId: 0,
          players: [{ orderId: 0, colorId: 0, name: msg.playerName || '玩家1', role: '黑棋', color: PLAYER_COLORS[0] }]
        });
        break;
      }
      
      case 'join': {
        const room = rooms.get(msg.roomId);
        if (!room) {
          safeSend(ws, { type: 'error', message: '房间不存在' });
          return;
        }
        
        // 游戏已开始，尝试重连
        if (room.gameStarted) {
          // 查找离线玩家（通过名字匹配）
          const offlinePlayer = room.players.find(p => !p.ws || p.ws.readyState !== WebSocket.OPEN);
          
          if (offlinePlayer && offlinePlayer.name === msg.playerName) {
            offlinePlayer.ws = ws;
            offlinePlayer.reconnecting = true;
            
            currentRoom = room;
            playerInfo = offlinePlayer;
            
            // 发送完整的游戏状态
            safeSend(ws, { 
              type: 'rejoined', 
              roomId: room.id,
              orderId: offlinePlayer.orderId,
              colorId: offlinePlayer.colorId,
              board: room.board,
              currentPlayer: room.currentPlayer,
              players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
            });
            
            // 通知房主有玩家重连
            const owner = room.players.find(p => p.orderId === room.players[0]?.orderId);
            if (owner && owner.ws && owner.ws.readyState === WebSocket.OPEN) {
              safeSend(owner.ws, {
                type: 'playerReconnectRequest',
                playerName: offlinePlayer.name,
                orderId: offlinePlayer.orderId
              });
            }
            
            broadcast(room, {
              type: 'playerReconnected',
              playerName: offlinePlayer.name,
              players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
            });
          } else {
            safeSend(ws, { type: 'error', message: '游戏已开始，无法加入' });
          }
          return;
        }
        
        // 游戏未开始，检查是否满员
        if (room.players.length >= 10) {
          safeSend(ws, { type: 'error', message: '房间已满' });
          return;
        }
        
        // 新玩家加入
        const takenColors = room.players.map(p => p.colorId);
        let selectedColorId = msg.colorId;
        if (selectedColorId === null || takenColors.includes(selectedColorId)) {
          for (let i = 0; i < 10; i++) {
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
          color: PLAYER_COLORS[selectedColorId],
          role: PLAYER_ROLES[selectedColorId],
          ws: ws
        };
        room.players.push(player);
        
        currentRoom = room;
        playerInfo = player;
        
        safeSend(ws, { 
          type: 'joined', 
          roomId: room.id, 
          orderId: player.orderId,
          colorId: player.colorId,
          ownerOrderId: room.players[0]?.orderId,
          players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
        });
        
        broadcast(room, {
          type: 'playerJoined',
          players: room.players.map(p => ({ orderId: p.orderId, colorId: p.colorId, name: p.name, role: p.role, color: p.color }))
        });
        break;
      }
      
      case 'continueGame': {
        // 房主选择继续游戏
        if (!currentRoom) return;
        if (msg.orderId !== currentRoom.players[0]?.orderId) return; // 只有房主
        
        currentRoom.waitingReconnect = false;
        currentRoom.lastActivity = Date.now();
        
        broadcast(currentRoom, {
          type: 'gameContinued',
          currentPlayer: currentRoom.currentPlayer
        });
        break;
      }
      
      case 'skipOffline': {
        // 房主选择跳过离线玩家
        if (!currentRoom || !currentRoom.waitingReconnect) return;
        if (msg.orderId !== currentRoom.players[0]?.orderId) return;
        
        const onlinePlayers = currentRoom.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
        const currentIdx = onlinePlayers.findIndex(p => p.orderId === currentRoom.currentPlayer);
        
        if (onlinePlayers.length > 0) {
          const nextIdx = (currentIdx + 1) % onlinePlayers.length;
          currentRoom.currentPlayer = onlinePlayers[nextIdx].orderId;
        }
        
        currentRoom.waitingReconnect = false;
        currentRoom.lastActivity = Date.now();
        
        broadcast(currentRoom, {
          type: 'offlineSkipped',
          currentPlayer: currentRoom.currentPlayer
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
        currentRoom.waitingReconnect = false;
        
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
        if (currentRoom.waitingReconnect) return; // 等待重连时不能下棋
        
        const { row, col } = msg;
        if (row < 0 || row >= 15 || col < 0 || col >= 15) return;
        if (currentRoom.board[row][col] !== 0) return;
        
        const currentPlayer = currentRoom.players.find(p => p.orderId === msg.orderId);
        if (!currentPlayer) return;
        
        currentRoom.board[row][col] = currentPlayer.colorId + 1;
        currentRoom.history.push({ row, col, player: msg.orderId, colorId: currentPlayer.colorId, timestamp: Date.now() });
        currentRoom.lastActivity = Date.now();
        
        const isWin = checkWin(currentRoom.board, row, col, currentPlayer.colorId + 1);
        
        const moveData = { type: 'move', row, col, orderId: msg.orderId, colorId: currentPlayer.colorId };
        
        if (isWin) {
          currentRoom.winner = msg.orderId;
          moveData.winner = msg.orderId;
          moveData.gameOver = true;
          currentRoom.waitingReconnect = false;
        } else {
          currentRoom.currentPlayer = (currentRoom.currentPlayer + 1) % currentRoom.players.length;
          moveData.currentPlayer = currentRoom.currentPlayer;
        }
        
        broadcast(currentRoom, moveData);
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
          if (!room.gameStarted && room.players.length > 0) {
            roomList.push({ id, playerCount: room.players.length });
          }
        });
        safeSend(ws, { type: 'rooms', rooms: roomList });
        break;
      }
      
      case 'leave': {
        if (currentRoom) {
          // 游戏已开始，标记离线
          if (currentRoom.gameStarted) {
            playerInfo.ws = null;
            playerInfo.offline = true;
            
            broadcast(currentRoom, {
              type: 'playerOffline',
              playerName: playerInfo.name,
              orderId: playerInfo.orderId
            });
            
            // 如果是当前玩家，进入等待重连模式
            if (currentRoom.currentPlayer === playerInfo.orderId) {
              currentRoom.waitingReconnect = true;
              currentRoom.lastActivity = Date.now();
              
              broadcast(currentRoom, {
                type: 'waitingReconnect',
                waitingFor: playerInfo.name
              });
            }
          } else {
            // 游戏未开始，直接移除
            const idx = currentRoom.players.indexOf(playerInfo);
            if (idx > -1) {
              const playerName = playerInfo.name;
              currentRoom.players.splice(idx, 1);
              
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
          currentRoom = null;
          playerInfo = null;
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && playerInfo) {
      // 游戏已开始，标记离线
      if (currentRoom.gameStarted) {
        playerInfo.ws = null;
        playerInfo.offline = true;
        
        broadcast(currentRoom, {
          type: 'playerOffline',
          playerName: playerInfo.name,
          orderId: playerInfo.orderId
        });
        
        // 如果是当前玩家，进入等待重连模式
        if (currentRoom.currentPlayer === playerInfo.orderId) {
          currentRoom.waitingReconnect = true;
          currentRoom.lastActivity = Date.now();
          
          broadcast(currentRoom, {
            type: 'waitingReconnect',
            waitingFor: playerInfo.name
          });
        }
      } else {
        // 游戏未开始，直接移除
        const idx = currentRoom.players.indexOf(playerInfo);
        if (idx > -1) {
          const playerName = playerInfo.name;
          currentRoom.players.splice(idx, 1);
          
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
        currentRoom = null;
        playerInfo = null;
      }
    }
  });
});

// Clean up every 3 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  rooms.forEach((room, roomId) => {
    // 空房间删除
    if (room.players.length === 0) {
      rooms.delete(roomId);
      cleaned++;
      return;
    }
    
    // 游戏中的房间，检查是否所有玩家都离线
    if (room.gameStarted) {
      const onlineCount = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN).length;
      
      if (onlineCount === 0) {
        rooms.delete(roomId);
        cleaned++;
        return;
      }
      
      // 等待重连超时（5分钟）
      if (room.waitingReconnect && now - room.lastActivity > 5 * 60 * 1000) {
        // 移除离线玩家
        room.players = room.players.filter(p => p.ws && p.ws.readyState === WebSocket.OPEN);
        room.waitingReconnect = false;
        
        if (room.players.length > 0) {
          // 继续游戏
          const onlinePlayers = room.players;
          room.currentPlayer = onlinePlayers[0].orderId;
          
          broadcast(room, {
            type: 'offlineSkipped',
            currentPlayer: room.currentPlayer
          });
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
