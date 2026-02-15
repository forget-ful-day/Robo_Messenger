require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100
});
app.use('/api/', limiter);

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const DB_PATH = process.env.DB_PATH || './chat.db';
const PORT = process.env.PORT || 3000;

// Database initialization
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT '😊',
      custom_emojis TEXT DEFAULT '[]',
      status TEXT DEFAULT 'online',
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted BOOLEAN DEFAULT 0,
      deleted_at DATETIME
    )
  `);

  // Groups table
  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      avatar TEXT DEFAULT '👥',
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_private BOOLEAN DEFAULT 0,
      FOREIGN KEY (created_by) REFERENCES users (id)
    )
  `);

  // Group members table
  db.run(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, user_id)
    )
  `);

  // Group invites table (for private groups)
  db.run(`
    CREATE TABLE IF NOT EXISTS group_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      invited_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (invited_by) REFERENCES users (id) ON DELETE CASCADE
    )
  `);

  // Messages table with group support
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      sender_name TEXT NOT NULL,
      sender_avatar TEXT,
      receiver_id INTEGER,
      group_id INTEGER,
      message TEXT NOT NULL,
      message_type TEXT DEFAULT 'text',
      is_private BOOLEAN DEFAULT 0,
      read BOOLEAN DEFAULT 0,
      read_by TEXT DEFAULT '[]',
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted BOOLEAN DEFAULT 0,
      FOREIGN KEY (sender_id) REFERENCES users (id),
      FOREIGN KEY (receiver_id) REFERENCES users (id),
      FOREIGN KEY (group_id) REFERENCES groups (id) ON DELETE CASCADE
    )
  `);

  // Conversations table
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id INTEGER NOT NULL,
      user2_id INTEGER NOT NULL,
      last_message TEXT,
      last_message_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      unread_count_user1 INTEGER DEFAULT 0,
      unread_count_user2 INTEGER DEFAULT 0,
      FOREIGN KEY (user1_id) REFERENCES users (id),
      FOREIGN KEY (user2_id) REFERENCES users (id),
      UNIQUE(user1_id, user2_id)
    )
  `);

  // Custom emojis table
  db.run(`
    CREATE TABLE IF NOT EXISTS custom_emojis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, created_by)
    )
  `);

  // Seed common public groups on first launch
  db.get('SELECT COUNT(*) as count FROM groups', (err, row) => {
    if (!err && row && row.count === 0) {
      const commonGroups = [
        ['Общий чат', 'Главный общий чат для всех пользователей', '🌍'],
        ['Знакомства', 'Здесь можно познакомиться с участниками', '🤝'],
        ['Новости', 'Важные объявления и новости сервиса', '📰']
      ];

      commonGroups.forEach(([name, description, avatar]) => {
        db.run(
          'INSERT INTO groups (name, description, avatar, created_by, is_private) VALUES (?, ?, ?, ?, 0)',
          [name, description, avatar, 1]
        );
      });
    }
  });
});

// WebSocket connections
const clients = new Map(); // ws -> { userId, username, avatar, rooms }

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      
      switch(message.type) {
        case 'auth':
          await handleAuth(ws, message);
          break;
        case 'public_message':
          await handlePublicMessage(ws, message);
          break;
        case 'private_message':
          await handlePrivateMessage(ws, message);
          break;
        case 'group_message':
          await handleGroupMessage(ws, message);
          break;
        case 'update_avatar':
          await handleUpdateAvatar(ws, message);
          break;
        case 'add_custom_emoji':
          await handleAddCustomEmoji(ws, message);
          break;
        case 'create_group':
          await handleCreateGroup(ws, message);
          break;
        case 'join_group':
          await handleJoinGroup(ws, message);
          break;
        case 'leave_group':
          await handleLeaveGroup(ws, message);
          break;
        case 'delete_account':
          await handleDeleteAccount(ws, message);
          break;
        case 'mark_read':
          await handleMarkRead(message);
          break;
        case 'typing':
          await handleTyping(ws, message);
          break;
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to process message'
      }));
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });
});

// WebSocket Handlers
async function handleAuth(ws, message) {
  db.get('SELECT avatar, custom_emojis FROM users WHERE id = ? AND deleted = 0', 
    [message.userId], 
    (err, row) => {
      if (err || !row) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication failed' }));
        return;
      }

      const userData = {
        userId: message.userId,
        username: message.username,
        avatar: row.avatar,
        customEmojis: JSON.parse(row.custom_emojis || '[]'),
        rooms: new Set(['public'])
      };

      clients.set(ws, userData);
      ws.username = message.username;
      ws.userId = message.userId;
      ws.avatar = row.avatar;

      // Update user status
      db.run('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?', 
        ['online', message.userId]);

      // Get user's groups
      db.all(
        `SELECT g.* FROM groups g
         JOIN group_members gm ON g.id = gm.group_id
         WHERE gm.user_id = ?`,
        [message.userId],
        (err, groups) => {
          if (!err && groups) {
            groups.forEach(group => {
              userData.rooms.add(`group:${group.id}`);
            });
            
            ws.send(JSON.stringify({
              type: 'groups_list',
              groups: groups
            }));
          }
        }
      );

      // Send last 50 public messages
      db.all(
        `SELECT * FROM messages 
         WHERE is_private = 0 AND group_id IS NULL AND deleted = 0
         ORDER BY timestamp DESC LIMIT 50`,
        (err, rows) => {
          if (!err) {
            ws.send(JSON.stringify({
              type: 'history',
              messages: rows.reverse()
            }));
          }
        }
      );

      broadcastUserList();
    }
  );
}

async function handlePublicMessage(ws, message) {
  db.run(
    `INSERT INTO messages 
     (sender_id, sender_name, sender_avatar, message, message_type, is_private) 
     VALUES (?, ?, ?, ?, ?, 0)`,
    [message.userId, message.username, message.avatar, message.text, message.messageType || 'text'],
    function(err) {
      if (!err) {
        const newMessage = {
          id: this.lastID,
          sender_id: message.userId,
          sender_name: message.username,
          sender_avatar: message.avatar,
          message: message.text,
          message_type: message.messageType || 'text',
          is_private: false,
          timestamp: new Date().toISOString()
        };

        broadcastToRoom('public', {
          type: 'new_public_message',
          message: newMessage
        });
      }
    }
  );
}

async function handlePrivateMessage(ws, message) {
  db.run(
    `INSERT INTO messages 
     (sender_id, sender_name, sender_avatar, receiver_id, message, message_type, is_private) 
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
    [message.userId, message.username, message.avatar, message.receiverId, message.text, message.messageType || 'text'],
    function(err) {
      if (!err) {
        const newMessage = {
          id: this.lastID,
          sender_id: message.userId,
          sender_name: message.username,
          sender_avatar: message.avatar,
          receiver_id: message.receiverId,
          message: message.text,
          message_type: message.messageType || 'text',
          is_private: true,
          timestamp: new Date().toISOString()
        };

        updateConversation(message.userId, message.receiverId, message.text);

        // Send to receiver if online
        let receiverSent = false;
        wss.clients.forEach((client) => {
          const clientData = clients.get(client);
          if (clientData && clientData.userId === message.receiverId) {
            client.send(JSON.stringify({
              type: 'new_private_message',
              message: newMessage
            }));
            receiverSent = true;
          }
        });

        ws.send(JSON.stringify({
          type: 'private_message_sent',
          message: newMessage,
          receiverOnline: receiverSent
        }));
      }
    }
  );
}

async function handleGroupMessage(ws, message) {
  // Check if user is member of the group
  db.get(
    'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?',
    [message.groupId, message.userId],
    (err, member) => {
      if (!member) {
        ws.send(JSON.stringify({ type: 'error', message: 'You are not a member of this group' }));
        return;
      }

      db.run(
        `INSERT INTO messages 
         (sender_id, sender_name, sender_avatar, group_id, message, message_type, is_private) 
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [message.userId, message.username, message.avatar, message.groupId, message.text, message.messageType || 'text'],
        function(err) {
          if (!err) {
            const newMessage = {
              id: this.lastID,
              sender_id: message.userId,
              sender_name: message.username,
              sender_avatar: message.avatar,
              group_id: message.groupId,
              message: message.text,
              message_type: message.messageType || 'text',
              timestamp: new Date().toISOString()
            };

            broadcastToRoom(`group:${message.groupId}`, {
              type: 'new_group_message',
              message: newMessage
            });
          }
        }
      );
    }
  );
}

async function handleUpdateAvatar(ws, message) {
  db.run(
    'UPDATE users SET avatar = ? WHERE id = ?',
    [message.avatar, message.userId],
    function(err) {
      if (!err) {
        const clientData = clients.get(ws);
        if (clientData) {
          clientData.avatar = message.avatar;
          ws.avatar = message.avatar;
        }
        
        broadcastUserList();
        
        ws.send(JSON.stringify({
          type: 'avatar_updated',
          avatar: message.avatar
        }));
      }
    }
  );
}

async function handleAddCustomEmoji(ws, message) {
  db.run(
    'INSERT INTO custom_emojis (name, emoji, created_by) VALUES (?, ?, ?)',
    [message.name, message.emoji, message.userId],
    function(err) {
      if (err) {
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: 'Emoji name already exists' 
        }));
        return;
      }

      // Update user's custom emojis list
      db.get('SELECT custom_emojis FROM users WHERE id = ?', [message.userId], (err, row) => {
        if (!err && row) {
          const emojis = JSON.parse(row.custom_emojis || '[]');
          emojis.push({ id: this.lastID, name: message.name, emoji: message.emoji });
          
          db.run('UPDATE users SET custom_emojis = ? WHERE id = ?', 
            [JSON.stringify(emojis), message.userId]);
        }
      });

      ws.send(JSON.stringify({
        type: 'custom_emoji_added',
        emoji: { id: this.lastID, name: message.name, emoji: message.emoji }
      }));

      broadcastToAll({
        type: 'new_custom_emoji',
        emoji: { name: message.name, emoji: message.emoji, created_by: message.userId }
      });
    }
  );
}

async function handleCreateGroup(ws, message) {
  const MAX_GROUP_SIZE = parseInt(process.env.MAX_GROUP_SIZE) || 50;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run(
      'INSERT INTO groups (name, description, avatar, created_by, is_private) VALUES (?, ?, ?, ?, ?)',
      [message.name, message.description, message.avatar || '👥', message.userId, message.isPrivate || false],
      function(err) {
        if (err) {
          db.run('ROLLBACK');
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to create group' }));
          return;
        }

        const groupId = this.lastID;

        // Add creator as admin
        db.run(
          'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
          [groupId, message.userId, 'admin'],
          (err) => {
            if (err) {
              db.run('ROLLBACK');
              ws.send(JSON.stringify({ type: 'error', message: 'Failed to add creator to group' }));
              return;
            }

            db.run('COMMIT');

            const newGroup = {
              id: groupId,
              name: message.name,
              description: message.description,
              avatar: message.avatar || '👥',
              created_by: message.userId,
              is_private: message.isPrivate || false,
              member_count: 1
            };

            // Add group to creator's rooms
            const clientData = clients.get(ws);
            if (clientData) {
              clientData.rooms.add(`group:${groupId}`);
            }

            ws.send(JSON.stringify({
              type: 'group_created',
              group: newGroup
            }));

            broadcastUserList();
          }
        );
      }
    );
  });
}

async function handleJoinGroup(ws, message) {
  // Check if group exists and is not private or user has invite
  db.get('SELECT * FROM groups WHERE id = ?', [message.groupId], (err, group) => {
    if (err || !group) {
      ws.send(JSON.stringify({ type: 'error', message: 'Group not found' }));
      return;
    }

    if (group.is_private) {
      // Check if user was invited
      db.get('SELECT * FROM group_invites WHERE group_id = ? AND user_id = ?',
        [message.groupId, message.userId],
        (err, invite) => {
          if (!invite) {
            ws.send(JSON.stringify({ type: 'error', message: 'This is a private group' }));
            return;
          }
          addUserToGroup(ws, message.groupId, message.userId);
        }
      );
    } else {
      addUserToGroup(ws, message.groupId, message.userId);
    }
  });
}

function addUserToGroup(ws, groupId, userId) {
  db.run(
    'INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
    [groupId, userId, 'member'],
    function(err) {
      if (!err && this.changes > 0) {
        const clientData = clients.get(ws);
        if (clientData) {
          clientData.rooms.add(`group:${groupId}`);
        }

        // Get group details
        db.get('SELECT * FROM groups WHERE id = ?', [groupId], (err, group) => {
          if (!err && group) {
            ws.send(JSON.stringify({
              type: 'joined_group',
              group: group
            }));

            // Notify group members
            broadcastToRoom(`group:${groupId}`, {
              type: 'user_joined_group',
              userId: userId,
              username: ws.username,
              groupId: groupId
            });
          }
        });
      }
    }
  );
}

async function handleLeaveGroup(ws, message) {
  db.run(
    'DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
    [message.groupId, message.userId],
    function(err) {
      if (!err) {
        const clientData = clients.get(ws);
        if (clientData) {
          clientData.rooms.delete(`group:${message.groupId}`);
        }

        ws.send(JSON.stringify({
          type: 'left_group',
          groupId: message.groupId
        }));

        broadcastToRoom(`group:${message.groupId}`, {
          type: 'user_left_group',
          userId: message.userId,
          username: ws.username,
          groupId: message.groupId
        });
      }
    }
  );
}

async function handleDeleteAccount(ws, message) {
  const userId = message.userId;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    // Soft delete user
    db.run(
      'UPDATE users SET deleted = 1, deleted_at = CURRENT_TIMESTAMP, status = ? WHERE id = ?',
      ['deleted', userId],
      (err) => {
        if (err) {
          db.run('ROLLBACK');
          ws.send(JSON.stringify({ type: 'error', message: 'Failed to delete account' }));
          return;
        }

        // Anonymize user's messages
        db.run(
          `UPDATE messages 
           SET sender_name = 'Deleted User', 
               sender_avatar = '👻',
               message = '[This user has been deleted]'
           WHERE sender_id = ?`,
          [userId],
          (err) => {
            if (err) {
              db.run('ROLLBACK');
              ws.send(JSON.stringify({ type: 'error', message: 'Failed to anonymize messages' }));
              return;
            }

            db.run('COMMIT');

            // Remove user from all groups
            db.run('DELETE FROM group_members WHERE user_id = ?', [userId]);

            // Disconnect user
            ws.send(JSON.stringify({
              type: 'account_deleted',
              message: 'Your account has been successfully deleted'
            }));

            // Close connection after sending confirmation
            setTimeout(() => {
              ws.close();
            }, 1000);

            broadcastUserList();
          }
        );
      }
    );
  });
}

async function handleMarkRead(message) {
  db.run(
    `UPDATE messages SET read = 1, read_by = json_insert(read_by, '$[#]', ?)
     WHERE sender_id = ? AND receiver_id = ? AND read = 0`,
    [message.userId, message.otherUserId, message.userId]
  );
}

async function handleTyping(ws, message) {
  const room = message.isPrivate ? 
    `private:${[message.userId, message.receiverId].sort().join(':')}` :
    message.groupId ? `group:${message.groupId}` : 'public';
  
  broadcastToRoom(room, {
    type: 'typing',
    userId: message.userId,
    username: ws.username,
    isTyping: message.isTyping,
    isPrivate: message.isPrivate,
    receiverId: message.receiverId,
    groupId: message.groupId
  }, ws);
}

function handleDisconnect(ws) {
  const clientData = clients.get(ws);
  if (clientData) {
    db.run('UPDATE users SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?', 
      ['offline', clientData.userId]);
    clients.delete(ws);
    broadcastUserList();
  }
}

// Helper functions
function broadcastToRoom(room, message, excludeWs = null) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
      const clientData = clients.get(client);
      if (clientData && clientData.rooms.has(room)) {
        client.send(JSON.stringify(message));
      }
    }
  });
}

function broadcastToAll(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

function broadcastUserList() {
  db.all(
    'SELECT id, username, avatar, status FROM users WHERE deleted = 0',
    (err, users) => {
      if (!err) {
        const userList = users.map(u => ({
          id: u.id,
          username: u.username,
          avatar: u.avatar,
          status: u.status
        }));
        
        broadcastToAll({
          type: 'user_list',
          users: userList
        });
      }
    }
  );
}

function updateConversation(user1Id, user2Id, lastMessage) {
  const [smallerId, largerId] = [user1Id, user2Id].sort((a, b) => a - b);
  
  db.get(
    'SELECT * FROM conversations WHERE user1_id = ? AND user2_id = ?',
    [smallerId, largerId],
    (err, row) => {
      if (row) {
        db.run(
          `UPDATE conversations 
           SET last_message = ?, last_message_time = CURRENT_TIMESTAMP,
               unread_count_user1 = unread_count_user1 + ?,
               unread_count_user2 = unread_count_user2 + ?
           WHERE user1_id = ? AND user2_id = ?`,
          [
            lastMessage,
            user1Id === smallerId ? 0 : 1,
            user2Id === smallerId ? 0 : 1,
            smallerId,
            largerId
          ]
        );
      } else {
        db.run(
          `INSERT INTO conversations 
           (user1_id, user2_id, last_message, unread_count_user1, unread_count_user2) 
           VALUES (?, ?, ?, ?, ?)`,
          [
            smallerId,
            largerId,
            lastMessage,
            user1Id === smallerId ? 0 : 1,
            user2Id === smallerId ? 0 : 1
          ]
        );
      }
    }
  );
}

// REST API endpoints
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/register', async (req, res) => {
  const { username, password, avatar } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const userAvatar = avatar || '😊';
    
    db.run(
      'INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)',
      [username, hashedPassword, userAvatar],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: 'Database error' });
        }

        const createdUserId = this.lastID;

        // Auto-join all public (common) groups
        db.all('SELECT id FROM groups WHERE is_private = 0', (groupsErr, groups) => {
          if (!groupsErr && groups && groups.length > 0) {
            groups.forEach((group) => {
              db.run(
                'INSERT OR IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
                [group.id, createdUserId, 'member']
              );
            });
          }

          const token = jwt.sign(
            { id: createdUserId, username },
            JWT_SECRET,
            { expiresIn: '24h' }
          );

          res.json({
            id: createdUserId,
            username,
            avatar: userAvatar,
            token
          });
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  db.get(
    'SELECT * FROM users WHERE username = ? AND deleted = 0',
    [username],
    async (err, user) => {
      if (err || !user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        token
      });
    }
  );
});

// Middleware to verify token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Protected API endpoints
app.get('/api/messages', authenticateToken, (req, res) => {
  db.all(
    `SELECT * FROM messages 
     WHERE is_private = 0 AND group_id IS NULL AND deleted = 0
     ORDER BY timestamp DESC LIMIT 100`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows.reverse());
    }
  );
});

app.get('/api/users', authenticateToken, (req, res) => {
  db.all(
    'SELECT id, username, avatar, status FROM users WHERE deleted = 0',
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows);
    }
  );
});

app.get('/api/groups', authenticateToken, (req, res) => {
  db.all(
    `SELECT g.*, COUNT(gm.user_id) as member_count
     FROM groups g
     LEFT JOIN group_members gm ON g.id = gm.group_id
     WHERE g.id IN (
       SELECT group_id FROM group_members WHERE user_id = ?
     )
     GROUP BY g.id`,
    [req.user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows);
    }
  );
});

app.get('/api/public-groups', authenticateToken, (req, res) => {
  db.all(
    `SELECT g.*, COUNT(gm.user_id) as member_count,
            CASE WHEN ugm.user_id IS NULL THEN 0 ELSE 1 END as is_member
     FROM groups g
     LEFT JOIN group_members gm ON g.id = gm.group_id
     LEFT JOIN group_members ugm ON g.id = ugm.group_id AND ugm.user_id = ?
     WHERE g.is_private = 0
     GROUP BY g.id
     ORDER BY g.created_at ASC`,
    [req.user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows);
    }
  );
});

app.get('/api/group-messages/:groupId', authenticateToken, (req, res) => {
  db.all(
    `SELECT * FROM messages 
     WHERE group_id = ? AND deleted = 0
     ORDER BY timestamp DESC LIMIT 100`,
    [req.params.groupId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows.reverse());
    }
  );
});

app.get('/api/private-messages/:userId', authenticateToken, (req, res) => {
  const currentUserId = req.user.id;
  const otherUserId = parseInt(req.params.userId);
  
  db.all(
    `SELECT * FROM messages 
     WHERE ((sender_id = ? AND receiver_id = ?) 
        OR (sender_id = ? AND receiver_id = ?))
        AND deleted = 0
     ORDER BY timestamp ASC`,
    [currentUserId, otherUserId, otherUserId, currentUserId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      db.run(
        `UPDATE messages SET read = 1 
         WHERE sender_id = ? AND receiver_id = ? AND read = 0`,
        [otherUserId, currentUserId]
      );
      
      res.json(rows);
    }
  );
});

app.get('/api/avatars', (req, res) => {
  const avatars = ['😊', '😂', '🤣', '❤️', '😍', '🤔', '😎', '😢', '😡', '👍', '👋', '🎉', '🔥', '⭐', '💯', '✅', '🐱', '🐶', '🐼', '🦊', '🐸', '🐧', '🌈', '🍕', '⚽', '🏀', '🎮', '📚', '💻', '🎵', '🎨', '🚀'];
  res.json(avatars);
});

app.get('/api/custom-emojis/:userId', authenticateToken, (req, res) => {
  db.all(
    'SELECT * FROM custom_emojis WHERE created_by = ?',
    [req.params.userId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows);
    }
  );
});

app.post('/api/update-avatar', authenticateToken, (req, res) => {
  const { userId, avatar } = req.body;

  if (!avatar || req.user.id !== userId) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  db.run('UPDATE users SET avatar = ? WHERE id = ? AND deleted = 0', [avatar, userId], function(err) {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    broadcastUserList();
    res.json({ success: true, avatar });
  });
});

app.post('/api/add-custom-emoji', authenticateToken, (req, res) => {
  const { userId, name, emoji } = req.body;

  if (!name || !emoji || req.user.id !== userId) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  db.run(
    'INSERT INTO custom_emojis (name, emoji, created_by) VALUES (?, ?, ?)',
    [name, emoji, userId],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Emoji name already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        success: true,
        emoji: { id: this.lastID, name, emoji }
      });
    }
  );
});

app.post('/api/delete-account', authenticateToken, (req, res) => {
  const userId = req.user.id;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run(
      'UPDATE users SET deleted = 1, deleted_at = CURRENT_TIMESTAMP, status = ? WHERE id = ?',
      ['deleted', userId],
      (err) => {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Failed to delete account' });
        }

        db.run(
          `UPDATE messages
           SET sender_name = 'Deleted User',
               sender_avatar = '👻',
               message = '[This user has been deleted]'
           WHERE sender_id = ?`,
          [userId],
          (updateErr) => {
            if (updateErr) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to anonymize messages' });
            }

            db.run('DELETE FROM group_members WHERE user_id = ?', [userId]);
            db.run('COMMIT');
            broadcastUserList();
            res.json({ success: true });
          }
        );
      }
    );
  });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Access from other devices using your local IP: http://YOUR_IP:${PORT}`);
});
