const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Секретный ключ для JWT
const JWT_SECRET = 'your-secret-key-change-this';

// JSON файлы для хранения данных
const DB_PATH = path.join(__dirname, 'database.json');

// Инициализация базы данных
async function initDB() {
    try {
        await fs.access(DB_PATH);
        console.log('✅ База данных найдена');
    } catch {
        // Создаем начальную структуру базы данных
        const initialDB = {
            users: [],
            groups: [],
            groupMembers: [],
            privateMessages: [],
            groupMessages: [],
            sessions: [],
            groupJoinRequests: [] // Новое: заявки на вступление
        };
        await fs.writeFile(DB_PATH, JSON.stringify(initialDB, null, 2));
        console.log('✅ Создана новая база данных');
        
        // Создаем несколько общих групп для примера
        await createDefaultGroups();
    }
}

// Создание групп по умолчанию
async function createDefaultGroups() {
    const db = await readDB();
    
    const defaultGroups = [
        {
            id: 1,
            name: "Общий чат",
            description: "Главная группа для всех пользователей",
            type: "public",
            created_by: null,
            avatar_url: "https://ui-avatars.com/api/?name=General&background=FF6B6B&color=fff",
            created_at: new Date().toISOString()
        },
        {
            id: 2,
            name: "Техническая поддержка",
            description: "Помощь и вопросы по использованию чата",
            type: "public",
            created_by: null,
            avatar_url: "https://ui-avatars.com/api/?name=Support&background=4ECDC4&color=fff",
            created_at: new Date().toISOString()
        },
        {
            id: 3,
            name: "Игры и развлечения",
            description: "Обсуждаем игры, кино и всё для отдыха",
            type: "public",
            created_by: null,
            avatar_url: "https://ui-avatars.com/api/?name=Games&background=45B7D1&color=fff",
            created_at: new Date().toISOString()
        },
        {
            id: 4,
            name: "Работа и карьера",
            description: "Вакансии, советы по работе, нетворкинг",
            type: "public",
            created_by: null,
            avatar_url: "https://ui-avatars.com/api/?name=Work&background=96CEB4&color=fff",
            created_at: new Date().toISOString()
        }
    ];
    
    db.groups = defaultGroups;
    await writeDB(db);
    console.log('✅ Созданы общие группы по умолчанию');
}

// Функции для работы с JSON
async function readDB() {
    const data = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(data);
}

async function writeDB(data) {
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// WebSocket для реального времени
const clients = new Map();

wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const token = urlParams.get('token');
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.userId;
        
        clients.set(userId, ws);
        
        // Обновляем статус онлайн
        (async () => {
            const db = await readDB();
            const user = db.users.find(u => u.id === userId);
            if (user) {
                user.is_online = true;
                user.last_seen = new Date().toISOString();
                await writeDB(db);
                
                // Отправляем всем обновленный статус
                broadcastUserStatus(userId, true);
            }
        })();
        
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                await handleWebSocketMessage(userId, data);
            } catch (error) {
                console.error('Ошибка обработки сообщения:', error);
            }
        });
        
        ws.on('close', async () => {
            clients.delete(userId);
            
            // Обновляем статус онлайн
            const db = await readDB();
            const user = db.users.find(u => u.id === userId);
            if (user) {
                user.is_online = false;
                user.last_seen = new Date().toISOString();
                await writeDB(db);
                
                // Отправляем всем обновленный статус
                broadcastUserStatus(userId, false);
            }
        });
    } catch (error) {
        console.error('Ошибка WebSocket подключения:', error);
        ws.close();
    }
});

// Рассылка статуса пользователя всем
function broadcastUserStatus(userId, isOnline) {
    const statusMessage = JSON.stringify({
        type: 'user_status',
        userId: userId,
        is_online: isOnline,
        last_seen: new Date().toISOString()
    });
    
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(statusMessage);
        }
    });
}

async function handleWebSocketMessage(senderId, data) {
    switch (data.type) {
        case 'private_message':
            await sendPrivateMessage(senderId, data.receiverId, data.message);
            break;
        case 'group_message':
            await sendGroupMessage(senderId, data.groupId, data.message);
            break;
        case 'join_group':
            await handleGroupJoinRequest(senderId, data.groupId);
            break;
        case 'typing':
            await handleTyping(senderId, data);
            break;
    }
}

async function sendPrivateMessage(senderId, receiverId, message) {
    const ws = clients.get(parseInt(receiverId));
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'new_message',
            message: {
                sender_id: senderId,
                message,
                created_at: new Date().toISOString()
            }
        }));
    }
}

async function sendGroupMessage(senderId, groupId, message) {
    const db = await readDB();
    const members = db.groupMembers.filter(m => m.group_id === groupId && m.user_id !== senderId);
    
    members.forEach(member => {
        const ws = clients.get(member.user_id);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'new_group_message',
                groupId: groupId,
                message: {
                    sender_id: senderId,
                    message,
                    created_at: new Date().toISOString()
                }
            }));
        }
    });
}

async function handleTyping(senderId, data) {
    const ws = clients.get(parseInt(data.receiverId));
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'typing',
            userId: senderId,
            isTyping: data.isTyping
        }));
    }
}

async function handleGroupJoinRequest(userId, groupId) {
    const db = await readDB();
    const group = db.groups.find(g => g.id === groupId);
    
    if (group && group.type === 'public') {
        // Автоматически добавляем в публичную группу
        const existing = db.groupMembers.find(
            m => m.group_id === groupId && m.user_id === userId
        );
        
        if (!existing) {
            db.groupMembers.push({
                group_id: groupId,
                user_id: userId,
                role: 'member',
                joined_at: new Date().toISOString()
            });
            await writeDB(db);
            
            // Уведомляем пользователя
            const ws = clients.get(userId);
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'group_joined',
                    groupId: groupId,
                    group: group
                }));
            }
        }
    }
}

// Регистрация
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Все поля обязательны' });
        }
        
        const db = await readDB();
        
        // Проверяем существование пользователя
        const existingUser = db.users.find(u => u.username === username || u.email === email);
        if (existingUser) {
            return res.status(400).json({ error: 'Пользователь уже существует' });
        }
        
        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создаем нового пользователя
        const newUser = {
            id: db.users.length + 1,
            username,
            email,
            password_hash: hashedPassword,
            avatar_url: `https://ui-avatars.com/api/?name=${username}&background=667eea&color=fff`,
            is_online: false,
            last_seen: new Date().toISOString(),
            created_at: new Date().toISOString()
        };
        
        db.users.push(newUser);
        
        // Автоматически добавляем пользователя во все публичные группы
        const publicGroups = db.groups.filter(g => g.type === 'public');
        publicGroups.forEach(group => {
            db.groupMembers.push({
                group_id: group.id,
                user_id: newUser.id,
                role: 'member',
                joined_at: new Date().toISOString()
            });
        });
        
        await writeDB(db);
        
        res.status(201).json({ message: 'Регистрация успешна' });
    } catch (error) {
        console.error('Ошибка регистрации:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Вход
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const db = await readDB();
        const user = db.users.find(u => u.username === username);
        
        if (!user) {
            return res.status(401).json({ error: 'Неверные учетные данные' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Неверные учетные данные' });
        }
        
        const token = jwt.sign(
            { userId: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        // Сохраняем сессию
        const session = {
            id: db.sessions.length + 1,
            user_id: user.id,
            token,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString()
        };
        
        db.sessions.push(session);
        await writeDB(db);
        
        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                avatar: user.avatar_url
            }
        });
    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Middleware для проверки токена
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Недействительный токен' });
        }
        req.user = user;
        next();
    });
}

// Проверка токена
app.get('/api/verify-token', authenticateToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// Получение списка пользователей
app.get('/api/users', authenticateToken, async (req, res) => {
    try {
        const db = await readDB();
        const users = db.users
            .filter(u => u.id !== req.user.userId)
            .map(u => ({
                id: u.id,
                username: u.username,
                avatar_url: u.avatar_url,
                is_online: u.is_online,
                last_seen: u.last_seen
            }));
        
        res.json(users);
    } catch (error) {
        console.error('Ошибка получения пользователей:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Личные сообщения
app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
    try {
        const otherUserId = parseInt(req.params.userId);
        const currentUserId = req.user.userId;
        
        const db = await readDB();
        const messages = db.privateMessages
            .filter(m => 
                (m.sender_id === currentUserId && m.receiver_id === otherUserId) ||
                (m.sender_id === otherUserId && m.receiver_id === currentUserId)
            )
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
        res.json(messages);
    } catch (error) {
        console.error('Ошибка получения сообщений:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
    try {
        const { receiverId, message } = req.body;
        const senderId = req.user.userId;
        
        const db = await readDB();
        
        const newMessage = {
            id: db.privateMessages.length + 1,
            sender_id: senderId,
            receiver_id: parseInt(receiverId),
            message,
            is_read: false,
            created_at: new Date().toISOString()
        };
        
        db.privateMessages.push(newMessage);
        await writeDB(db);
        
        // Отправляем через WebSocket
        await sendPrivateMessage(senderId, receiverId, message);
        
        res.json({ id: newMessage.id, success: true });
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение всех групп (публичных и приватных)
app.get('/api/groups', authenticateToken, async (req, res) => {
    try {
        const db = await readDB();
        const userId = req.user.userId;
        
        // Получаем все публичные группы
        const publicGroups = db.groups.filter(g => g.type === 'public');
        
        // Получаем приватные группы пользователя
        const userPrivateGroupIds = db.groupMembers
            .filter(gm => gm.user_id === userId)
            .map(gm => gm.group_id);
        
        const userPrivateGroups = db.groups.filter(
            g => g.type !== 'public' && userPrivateGroupIds.includes(g.id)
        );
        
        // Объединяем и добавляем информацию о членстве
        const allGroups = [...publicGroups, ...userPrivateGroups].map(group => {
            const members = db.groupMembers.filter(gm => gm.group_id === group.id);
            const isMember = members.some(m => m.user_id === userId);
            const userRole = members.find(m => m.user_id === userId)?.role;
            
            return {
                ...group,
                members_count: members.length,
                is_member: isMember,
                user_role: userRole
            };
        });
        
        res.json(allGroups);
    } catch (error) {
        console.error('Ошибка получения групп:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Создание группы (публичной или приватной)
app.post('/api/groups', authenticateToken, async (req, res) => {
    try {
        const { name, description, type = 'private' } = req.body;
        const userId = req.user.userId;
        
        const db = await readDB();
        
        const newGroup = {
            id: db.groups.length + 1,
            name,
            description,
            type, // 'public' или 'private'
            created_by: userId,
            avatar_url: `https://ui-avatars.com/api/?name=${name}&background=${Math.floor(Math.random()*16777215).toString(16)}&color=fff`,
            created_at: new Date().toISOString()
        };
        
        db.groups.push(newGroup);
        
        // Добавляем создателя как администратора
        db.groupMembers.push({
            group_id: newGroup.id,
            user_id: userId,
            role: 'admin',
            joined_at: new Date().toISOString()
        });
        
        await writeDB(db);
        
        res.json({ id: newGroup.id, success: true });
    } catch (error) {
        console.error('Ошибка создания группы:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Присоединение к публичной группе
app.post('/api/groups/:groupId/join', authenticateToken, async (req, res) => {
    try {
        const groupId = parseInt(req.params.groupId);
        const userId = req.user.userId;
        
        const db = await readDB();
        const group = db.groups.find(g => g.id === groupId);
        
        if (!group) {
            return res.status(404).json({ error: 'Группа не найдена' });
        }
        
        if (group.type !== 'public') {
            return res.status(403).json({ error: 'Это приватная группа. Требуется приглашение' });
        }
        
        // Проверяем, не состоит ли уже
        const existing = db.groupMembers.find(
            m => m.group_id === groupId && m.user_id === userId
        );
        
        if (!existing) {
            db.groupMembers.push({
                group_id: groupId,
                user_id: userId,
                role: 'member',
                joined_at: new Date().toISOString()
            });
            
            await writeDB(db);
            
            // Уведомляем других участников
            const members = db.groupMembers.filter(m => m.group_id === groupId && m.user_id !== userId);
            members.forEach(member => {
                const ws = clients.get(member.user_id);
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'member_joined',
                        groupId: groupId,
                        user: {
                            id: userId,
                            username: req.user.username
                        }
                    }));
                }
            });
        }
        
        res.json({ success: true, message: 'Вы присоединились к группе' });
    } catch (error) {
        console.error('Ошибка присоединения к группе:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Выход из группы
app.post('/api/groups/:groupId/leave', authenticateToken, async (req, res) => {
    try {
        const groupId = parseInt(req.params.groupId);
        const userId = req.user.userId;
        
        const db = await readDB();
        
        // Удаляем из группы
        db.groupMembers = db.groupMembers.filter(
            m => !(m.group_id === groupId && m.user_id === userId)
        );
        
        await writeDB(db);
        
        res.json({ success: true, message: 'Вы покинули группу' });
    } catch (error) {
        console.error('Ошибка выхода из группы:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение участников группы
app.get('/api/groups/:groupId/members', authenticateToken, async (req, res) => {
    try {
        const groupId = parseInt(req.params.groupId);
        const db = await readDB();
        
        const members = db.groupMembers
            .filter(m => m.group_id === groupId)
            .map(m => {
                const user = db.users.find(u => u.id === m.user_id);
                return {
                    id: user.id,
                    username: user.username,
                    avatar_url: user.avatar_url,
                    role: m.role,
                    joined_at: m.joined_at,
                    is_online: user.is_online
                };
            });
        
        res.json(members);
    } catch (error) {
        console.error('Ошибка получения участников:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Групповые сообщения
app.get('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
    try {
        const groupId = parseInt(req.params.groupId);
        const db = await readDB();
        
        const messages = db.groupMessages
            .filter(m => m.group_id === groupId)
            .map(msg => {
                const sender = db.users.find(u => u.id === msg.sender_id);
                return {
                    ...msg,
                    username: sender?.username || 'Неизвестно',
                    avatar_url: sender?.avatar_url
                };
            })
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
        res.json(messages);
    } catch (error) {
        console.error('Ошибка получения сообщений группы:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.post('/api/groups/:groupId/messages', authenticateToken, async (req, res) => {
    try {
        const groupId = parseInt(req.params.groupId);
        const { message } = req.body;
        const senderId = req.user.userId;
        
        const db = await readDB();
        
        const newMessage = {
            id: db.groupMessages.length + 1,
            group_id: groupId,
            sender_id: senderId,
            message,
            created_at: new Date().toISOString()
        };
        
        db.groupMessages.push(newMessage);
        await writeDB(db);
        
        // Отправляем через WebSocket
        await sendGroupMessage(senderId, groupId, message);
        
        res.json({ id: newMessage.id, success: true });
    } catch (error) {
        console.error('Ошибка отправки сообщения в группу:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удаление аккаунта
app.delete('/api/users/me', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const db = await readDB();
        
        // Удаляем пользователя
        db.users = db.users.filter(u => u.id !== userId);
        
        // Удаляем связанные данные
        db.privateMessages = db.privateMessages.filter(
            m => m.sender_id !== userId && m.receiver_id !== userId
        );
        db.groupMessages = db.groupMessages.filter(m => m.sender_id !== userId);
        db.groupMembers = db.groupMembers.filter(m => m.user_id !== userId);
        db.sessions = db.sessions.filter(s => s.user_id !== userId);
        
        await writeDB(db);
        
        // Закрываем WebSocket
        const ws = clients.get(userId);
        if (ws) {
            ws.close();
        }
        
        res.json({ message: 'Аккаунт удален' });
    } catch (error) {
        console.error('Ошибка удаления аккаунта:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Поиск пользователей
app.get('/api/search/users', authenticateToken, async (req, res) => {
    try {
        const { q } = req.query;
        const db = await readDB();
        
        const users = db.users
            .filter(u => 
                u.id !== req.user.userId && 
                u.username.toLowerCase().includes(q.toLowerCase())
            )
            .slice(0, 20)
            .map(u => ({
                id: u.id,
                username: u.username,
                avatar_url: u.avatar_url,
                is_online: u.is_online
            }));
        
        res.json(users);
    } catch (error) {
        console.error('Ошибка поиска:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Запуск сервера
async function startServer() {
    await initDB();
    
    const PORT = 3000;
    server.listen(PORT, '0.0.0.0', () => {
        console.log('\n' + '='.repeat(50));
        console.log('🚀 Сервер запущен на порту 3000');
        console.log('📁 База данных: JSON файл');
        console.log('👥 Общие группы: доступны всем');
        console.log('📱 Откройте http://localhost:3000');
        console.log('='.repeat(50) + '\n');
    });
}

startServer();