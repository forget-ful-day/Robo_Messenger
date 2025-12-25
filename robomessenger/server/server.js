const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Хранилище данных
const users = new Map(); // socket.id -> {id, username, status, avatar}
const messages = new Map(); // roomId -> [{id, sender, text, timestamp}]
const userRooms = new Map(); // username -> roomId с другим пользователем

// Генерация ID комнаты для двух пользователей
function getRoomId(user1, user2) {
  return [user1, user2].sort().join('-');
}

// Маршруты API
app.get('/api/users/online', (req, res) => {
  const onlineUsers = Array.from(users.values())
    .filter(user => user.status === 'online')
    .map(({id, username, avatar}) => ({id, username, avatar}));
  res.json(onlineUsers);
});

app.get('/api/messages/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const roomMessages = messages.get(roomId) || [];
  res.json(roomMessages);
});

app.post('/api/messages', (req, res) => {
  const { roomId, sender, text } = req.body;
  
  if (!messages.has(roomId)) {
    messages.set(roomId, []);
  }
  
  const message = {
    id: Date.now(),
    sender,
    text,
    timestamp: new Date().toISOString()
  };
  
  messages.get(roomId).push(message);
  
  // Отправляем сообщение всем в комнате через WebSocket
  io.to(roomId).emit('newMessage', message);
  
  res.status(201).json(message);
});

// WebSocket соединения
io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);

  // Пользователь входит в систему
  socket.on('userLogin', (userData) => {
    const user = {
      id: socket.id,
      username: userData.username,
      avatar: userData.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.username)}&background=random`,
      status: 'online'
    };
    
    users.set(socket.id, user);
    
    // Уведомляем всех о новом пользователе
    socket.broadcast.emit('userConnected', user);
    
    // Отправляем текущему пользователю список онлайн пользователей
    const onlineUsers = Array.from(users.values())
      .filter(u => u.id !== socket.id && u.status === 'online')
      .map(({id, username, avatar}) => ({id, username, avatar}));
    
    socket.emit('userList', onlineUsers);
    
    console.log(`Пользователь ${user.username} вошел в систему`);
  });

  // Начать чат с пользователем
  socket.on('startChat', ({ targetUsername }) => {
    const currentUser = users.get(socket.id);
    if (!currentUser) return;
    
    const roomId = getRoomId(currentUser.username, targetUsername);
    socket.join(roomId);
    
    // Сохраняем комнату пользователя
    userRooms.set(currentUser.username, roomId);
    
    // Если целевой пользователь онлайн, присоединяем его к комнате
    const targetUser = Array.from(users.values())
      .find(u => u.username === targetUsername && u.status === 'online');
    
    if (targetUser) {
      const targetSocket = io.sockets.sockets.get(targetUser.id);
      if (targetSocket) {
        targetSocket.join(roomId);
        userRooms.set(targetUsername, roomId);
        
        // Уведомляем обоих пользователей, что чат создан
        io.to(roomId).emit('chatStarted', {
          roomId,
          participants: [currentUser.username, targetUsername]
        });
      }
    }
    
    // Отправляем историю сообщений
    const roomMessages = messages.get(roomId) || [];
    socket.emit('messageHistory', roomMessages);
  });

  // Отправка сообщения
  socket.on('sendMessage', ({ roomId, text }) => {
    const currentUser = users.get(socket.id);
    if (!currentUser) return;
    
    if (!messages.has(roomId)) {
      messages.set(roomId, []);
    }
    
    const message = {
      id: Date.now(),
      sender: currentUser.username,
      text,
      timestamp: new Date().toISOString(),
      roomId
    };
    
    messages.get(roomId).push(message);
    
    // Отправляем сообщение всем в комнате
    io.to(roomId).emit('newMessage', message);
    
    // Уведомляем пользователей о новом сообщении
    const roomParticipants = roomId.split('-');
    roomParticipants.forEach(username => {
      const user = Array.from(users.values()).find(u => u.username === username);
      if (user && user.id !== socket.id) {
        io.to(user.id).emit('notification', {
          from: currentUser.username,
          message: text,
          roomId
        });
      }
    });
  });

  // Пользователь печатает
  socket.on('typing', ({ roomId, isTyping }) => {
    const currentUser = users.get(socket.id);
    if (!currentUser) return;
    
    socket.to(roomId).emit('userTyping', {
      username: currentUser.username,
      isTyping
    });
  });

  // Обновление статуса
  socket.on('updateStatus', (status) => {
    const user = users.get(socket.id);
    if (user) {
      user.status = status;
      socket.broadcast.emit('userStatusChanged', {
        username: user.username,
        status
      });
    }
  });

  // Отключение пользователя
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      user.status = 'offline';
      
      // Уведомляем всех о отключении пользователя
      socket.broadcast.emit('userDisconnected', {
        username: user.username
      });
      
      // Удаляем из активных пользователей через 5 минут
      setTimeout(() => {
        if (users.get(socket.id)?.status === 'offline') {
          users.delete(socket.id);
        }
      }, 300000);
      
      console.log(`Пользователь ${user.username} отключился`);
    }
  });
});

// Запуск сервера
server.listen(PORT, () => {
  console.log(`Сервер Робо Мессенджера запущен на порту ${PORT}`);
  console.log(`Откройте http://localhost:${PORT} в браузере`);
});