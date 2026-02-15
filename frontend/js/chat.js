const WS_URL = `ws://${window.location.hostname}:3000`;
const API_URL = `http://${window.location.hostname}:3000/api`;

// Проверка авторизации
const token = localStorage.getItem('token');
const userId = parseInt(localStorage.getItem('userId'));
const username = localStorage.getItem('username');
let userAvatar = localStorage.getItem('avatar') || '😊';
let customEmojis = [];

if (!token || !userId || !username) {
    window.location.href = 'login.html';
}

// Состояние приложения
let currentChat = {
    type: 'public',
    id: null,
    name: 'Public Chat',
    avatar: '🌐'
};

let users = [];
let groups = [];
let ws = null;
let typingTimeout = null;

// DOM элементы
document.addEventListener('DOMContentLoaded', function() {
    // Инициализация элементов
    const usernameDisplay = document.getElementById('usernameDisplay');
    const userAvatarElement = document.getElementById('userAvatar');
    const avatarEmoji = userAvatarElement?.querySelector('.avatar-emoji');
    
    if (usernameDisplay) usernameDisplay.textContent = username;
    if (avatarEmoji) avatarEmoji.textContent = userAvatar;
    
    // Загрузка эмодзи
    loadDefaultEmojis();
    
    // Инициализация обработчиков
    initializeEventListeners();
});

function initializeEventListeners() {
    // Меню для мобильных
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            document.getElementById('sidebar')?.classList.toggle('open');
        });
    }
    
    // Переключение вкладок
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            
            e.target.classList.add('active');
            const tabId = e.target.dataset.tab;
            const tabElement = document.getElementById(`${tabId}Tab`);
            if (tabElement) tabElement.classList.add('active');
        });
    });
    
    // Отправка сообщения
    const sendBtn = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (messageInput) {
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            } else {
                handleTyping();
            }
        });
    }
    
    // Палетка эмодзи
    const emojiTrigger = document.getElementById('emojiPickerTrigger');
    const emojiPicker = document.getElementById('emojiPicker');
    
    if (emojiTrigger && emojiPicker) {
        emojiTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            emojiPicker.classList.toggle('show');
        });
        
        document.addEventListener('click', (e) => {
            if (!emojiPicker.contains(e.target) && !emojiTrigger.contains(e.target)) {
                emojiPicker.classList.remove('show');
            }
        });
    }
    
    // Поиск эмодзи
    const emojiSearch = document.getElementById('emojiSearch');
    if (emojiSearch) {
        emojiSearch.addEventListener('input', updateEmojiList);
    }
    
    // Категории эмодзи
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            updateEmojiList();
        });
    });
    
    // Фильтры пользователей
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            if (users.length > 0) updateUsersList(users);
        });
    });
    
    // Выход
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.clear();
            window.location.href = 'index.html';
        });
    }
    
    // Показать свои эмодзи
    const showCustomEmojis = document.getElementById('showCustomEmojis');
    if (showCustomEmojis) {
        showCustomEmojis.addEventListener('click', showCustomEmojisModal);
    }
    
    // Закрытие модального окна
    const closeModalBtn = document.querySelector('#customEmojisModal .btn-secondary');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeCustomEmojisModal);
    }
}

// WebSocket соединение
function connectWebSocket() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log('Connected to chat server');
        ws.send(JSON.stringify({
            type: 'auth',
            userId: userId,
            username: username
        }));
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        showNotification('Connection error. Reconnecting...', 'error');
        setTimeout(connectWebSocket, 3000);
    };

    ws.onclose = () => {
        console.log('Disconnected from chat server');
        setTimeout(connectWebSocket, 3000);
    };
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'history':
            displayMessages(data.messages);
            break;
        case 'new_public_message':
            if (currentChat.type === 'public') {
                displayMessage(data.message);
            }
            break;
        case 'new_private_message':
            if (currentChat.type === 'private' && currentChat.id === data.message.sender_id) {
                displayMessage(data.message);
                markAsRead(data.message.sender_id);
            }
            updateUnreadCount(data.message.sender_id);
            break;
        case 'new_group_message':
            if (currentChat.type === 'group' && currentChat.id === data.message.group_id) {
                displayMessage(data.message);
            }
            break;
        case 'private_message_sent':
            if (currentChat.type === 'private') {
                displayMessage(data.message);
            }
            break;
        case 'user_list':
            users = data.users.filter(u => u.id !== userId);
            updateUsersList(users);
            break;
        case 'groups_list':
            groups = data.groups;
            updateGroupsList(groups);
            loadPublicGroups();
            break;
        case 'group_created':
            groups.push(data.group);
            updateGroupsList(groups);
            loadPublicGroups();
            showNotification(`Group created: ${data.group.name}`);
            break;
        case 'joined_group':
            groups.push(data.group);
            updateGroupsList(groups);
            loadPublicGroups();
            showNotification(`Joined group: ${data.group.name}`);
            break;
        case 'left_group':
            groups = groups.filter(g => g.id !== data.groupId);
            updateGroupsList(groups);
            if (currentChat.type === 'group' && currentChat.id === data.groupId) {
                startPublicChat();
            }
            showNotification('Left group');
            break;
        case 'avatar_updated':
            userAvatar = data.avatar;
            localStorage.setItem('avatar', data.avatar);
            const avatarEmoji = document.querySelector('#userAvatar .avatar-emoji');
            if (avatarEmoji) avatarEmoji.textContent = data.avatar;
            break;
        case 'custom_emoji_added':
            customEmojis.push(data.emoji);
            updateEmojiList();
            break;
        case 'typing':
            handleTypingIndicator(data);
            break;
        case 'error':
            showNotification(data.message, 'error');
            break;
    }
}

// Обновление списка пользователей
function updateUsersList(users) {
    const filter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
    const usersList = document.getElementById('usersList');
    
    if (!usersList) return;
    
    let filteredUsers = users;
    if (filter === 'online') {
        filteredUsers = users.filter(u => u.status === 'online');
    }
    
    usersList.innerHTML = '';
    
    filteredUsers.forEach(user => {
        const li = document.createElement('li');
        li.className = `user-item ${currentChat.type === 'private' && currentChat.id === user.id ? 'active' : ''}`;
        li.dataset.userId = user.id;
        
        li.innerHTML = `
            <div class="user-avatar">${user.avatar || '😊'}</div>
            <div class="user-details">
                <div class="user-name">
                    ${user.username}
                    <span class="unread-badge" style="display: none;">0</span>
                </div>
                <div class="user-status ${user.status === 'online' ? '' : 'offline'}">
                    <span class="status-dot ${user.status === 'online' ? '' : 'offline'}"></span>
                    ${user.status}
                </div>
            </div>
        `;
        
        li.addEventListener('click', () => startPrivateChat(user));
        usersList.appendChild(li);
    });
}

// Обновление списка групп
function updateGroupsList(groups) {
    const groupsList = document.getElementById('groupsList');
    if (!groupsList) return;
    
    groupsList.innerHTML = '';
    
    groups.forEach(group => {
        const li = document.createElement('li');
        li.className = `group-item ${currentChat.type === 'group' && currentChat.id === group.id ? 'active' : ''}`;
        li.dataset.groupId = group.id;
        
        li.innerHTML = `
            <div class="group-avatar">${group.avatar || '👥'}</div>
            <div class="group-details">
                <div class="group-name">${group.name}</div>
                <div class="group-members">${group.member_count || 1} members</div>
            </div>
        `;
        
        li.addEventListener('click', () => startGroupChat(group));
        groupsList.appendChild(li);
    });
}

async function loadPublicGroups() {
    const publicGroupsList = document.getElementById('publicGroupsList');
    if (!publicGroupsList) return;

    try {
        const response = await fetch(`${API_URL}/public-groups`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) return;

        const publicGroups = await response.json();
        publicGroupsList.innerHTML = '';

        publicGroups.forEach((group) => {
            const li = document.createElement('li');
            li.className = 'group-item';
            li.innerHTML = `
                <div class="group-avatar">${group.avatar || '👥'}</div>
                <div class="group-details">
                    <div class="group-name">${group.name}</div>
                    <div class="group-members">${group.member_count || 0} members</div>
                </div>
            `;

            const actionBtn = document.createElement('button');
            actionBtn.className = 'btn btn-primary';
            actionBtn.style.marginLeft = '8px';

            if (group.is_member) {
                actionBtn.textContent = 'Open';
                actionBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    startGroupChat(group);
                });
            } else {
                actionBtn.textContent = 'Join';
                actionBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'join_group',
                            userId: userId,
                            groupId: group.id
                        }));
                    }
                });
            }

            li.appendChild(actionBtn);
            publicGroupsList.appendChild(li);
        });
    } catch (error) {
        console.error('Error loading common groups:', error);
    }
}

// Начать приватный чат
function startPrivateChat(user) {
    currentChat = {
        type: 'private',
        id: user.id,
        name: user.username,
        avatar: user.avatar || '😊'
    };
    
    updateChatHeader();
    
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('active');
        if (parseInt(item.dataset.userId) === user.id) {
            item.classList.add('active');
        }
    });
    
    // Очистить непрочитанные
    const userItem = document.querySelector(`.user-item[data-user-id="${user.id}"]`);
    if (userItem) {
        const badge = userItem.querySelector('.unread-badge');
        if (badge) {
            badge.style.display = 'none';
            badge.textContent = '0';
        }
    }
    
    loadPrivateMessages(user.id);
}

// Начать групповой чат
function startGroupChat(group) {
    currentChat = {
        type: 'group',
        id: group.id,
        name: group.name,
        avatar: group.avatar || '👥'
    };
    
    updateChatHeader();
    
    const chatActions = document.getElementById('chatActions');
    if (chatActions) {
        chatActions.innerHTML = `
            <button class="leave-group-btn" onclick="leaveGroup(${group.id})">Leave Group</button>
        `;
    }
    
    document.querySelectorAll('.group-item').forEach(item => {
        item.classList.remove('active');
        if (parseInt(item.dataset.groupId) === group.id) {
            item.classList.add('active');
        }
    });
    
    loadGroupMessages(group.id);
}

// Начать публичный чат
function startPublicChat() {
    currentChat = {
        type: 'public',
        id: null,
        name: 'Public Chat',
        avatar: '🌐'
    };
    
    updateChatHeader();
    
    const chatActions = document.getElementById('chatActions');
    if (chatActions) chatActions.innerHTML = '';
    
    document.querySelectorAll('.user-item, .group-item').forEach(item => {
        item.classList.remove('active');
    });
    
    loadPublicMessages();
}

function updateChatHeader() {
    const chatAvatar = document.getElementById('currentChatAvatar');
    const chatName = document.getElementById('currentChatName');
    const modeIndicator = document.querySelector('.mode-indicator');
    
    if (chatAvatar) chatAvatar.textContent = currentChat.avatar;
    if (chatName) chatName.textContent = currentChat.name;
    if (modeIndicator) {
        modeIndicator.innerHTML = currentChat.type === 'public' ? '🌐 Public Chat' :
                                 currentChat.type === 'private' ? '🔒 Private Chat' :
                                 '👥 Group Chat';
    }
}

// Загрузка сообщений
async function loadPublicMessages() {
    try {
        const response = await fetch(`${API_URL}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const messages = await response.json();
            displayMessages(messages);
        }
    } catch (error) {
        console.error('Error loading public messages:', error);
    }
}

async function loadPrivateMessages(otherUserId) {
    try {
        const response = await fetch(`${API_URL}/private-messages/${otherUserId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const messages = await response.json();
            displayMessages(messages);
        }
    } catch (error) {
        console.error('Error loading private messages:', error);
    }
}

async function loadGroupMessages(groupId) {
    try {
        const response = await fetch(`${API_URL}/group-messages/${groupId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const messages = await response.json();
            displayMessages(messages);
        }
    } catch (error) {
        console.error('Error loading group messages:', error);
    }
}

// Отображение сообщений
function displayMessages(messages) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;
    
    messagesDiv.innerHTML = '';
    
    messages.forEach(message => {
        displayMessage(message);
    });
    
    scrollToBottom();
}

function displayMessage(message) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.sender_id === userId ? 'own-message' : ''} ${message.is_private ? 'private-message' : ''} ${message.group_id ? 'group-message' : ''}`;
    
    const timestamp = new Date(message.timestamp).toLocaleTimeString();
    const senderAvatar = message.sender_avatar || '😊';
    
    // Обработка кастомных эмодзи
    let messageContent = escapeHtml(message.message);
    if (customEmojis.length > 0) {
        customEmojis.forEach(emoji => {
            const regex = new RegExp(`:${emoji.name}:`, 'g');
            messageContent = messageContent.replace(regex, emoji.emoji);
        });
    }
    
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-avatar">${senderAvatar}</span>
            <span class="message-username">${message.sender_name}</span>
            ${message.is_private ? '<span class="private-indicator" title="Private message">🔒</span>' : ''}
            ${message.group_id ? '<span class="group-indicator" title="Group message">👥</span>' : ''}
            <span class="message-time">${timestamp}</span>
        </div>
        <div class="message-content">${messageContent}</div>
    `;
    
    messagesDiv.appendChild(messageDiv);
    scrollToBottom();
}

// Отправка сообщения
function sendMessage() {
    const input = document.getElementById('messageInput');
    if (!input || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    const text = input.value.trim();
    if (!text) return;
    
    const messageData = {
        type: currentChat.type === 'public' ? 'public_message' :
              currentChat.type === 'private' ? 'private_message' : 'group_message',
        userId: userId,
        username: username,
        avatar: userAvatar,
        text: text
    };
    
    if (currentChat.type === 'private') {
        messageData.receiverId = currentChat.id;
    } else if (currentChat.type === 'group') {
        messageData.groupId = currentChat.id;
    }
    
    ws.send(JSON.stringify(messageData));
    input.value = '';
}

// Эмодзи
const defaultEmojis = ['😊', '😂', '🤣', '❤️', '😍', '🤔', '😎', '😢', '😡', '👍', '👋', '🎉', '🔥', '⭐', '💯', '✅', '🐱', '🐶', '🐼', '🦊', '🐸', '🐧', '🌈', '🍕', '⚽', '🏀', '🎮', '📚', '💻', '🎵', '🎨', '🚀'];

function loadDefaultEmojis() {
    updateEmojiList();
}

function updateEmojiList() {
    const list = document.getElementById('emojiList');
    if (!list) return;
    
    const category = document.querySelector('.category-btn.active')?.dataset.category || 'default';
    const searchTerm = document.getElementById('emojiSearch')?.value.toLowerCase() || '';
    
    list.innerHTML = '';
    
    let emojis = [];
    if (category === 'default') {
        emojis = defaultEmojis;
    } else if (category === 'custom') {
        emojis = customEmojis.map(e => e.emoji);
    }
    
    if (searchTerm) {
        emojis = emojis.filter(e => e.includes(searchTerm));
    }
    
    emojis.forEach(emoji => {
        const div = document.createElement('div');
        div.className = 'emoji-item';
        div.textContent = emoji;
        div.addEventListener('click', () => {
            const input = document.getElementById('messageInput');
            if (input) {
                input.value += emoji;
                input.focus();
            }
            document.getElementById('emojiPicker')?.classList.remove('show');
        });
        list.appendChild(div);
    });
}

// Показать свои эмодзи
function showCustomEmojisModal() {
    const modal = document.getElementById('customEmojisModal');
    const grid = document.getElementById('customEmojisGrid');
    
    if (!modal || !grid) return;
    
    grid.innerHTML = '';
    
    if (customEmojis.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 20px;">No custom emojis yet</p>';
    } else {
        customEmojis.forEach(emoji => {
            const div = document.createElement('div');
            div.className = 'custom-emoji-item';
            div.innerHTML = `
                <span class="emoji-char">${emoji.emoji}</span>
                <span class="emoji-name">:${emoji.name}:</span>
            `;
            grid.appendChild(div);
        });
    }
    
    modal.classList.add('show');
}

function closeCustomEmojisModal() {
    document.getElementById('customEmojisModal')?.classList.remove('show');
}

// Индикатор печатания
function handleTyping() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    if (typingTimeout) {
        clearTimeout(typingTimeout);
    } else {
        ws.send(JSON.stringify({
            type: 'typing',
            userId: userId,
            username: username,
            isTyping: true,
            isPrivate: currentChat.type === 'private',
            receiverId: currentChat.type === 'private' ? currentChat.id : null,
            groupId: currentChat.type === 'group' ? currentChat.id : null
        }));
    }
    
    typingTimeout = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'typing',
                userId: userId,
                username: username,
                isTyping: false,
                isPrivate: currentChat.type === 'private',
                receiverId: currentChat.type === 'private' ? currentChat.id : null,
                groupId: currentChat.type === 'group' ? currentChat.id : null
            }));
        }
        typingTimeout = null;
    }, 1000);
}

function handleTypingIndicator(data) {
    const indicator = document.getElementById('typingIndicator');
    if (!indicator) return;
    
    if (data.isTyping) {
        indicator.style.display = 'flex';
        indicator.innerHTML = `<span></span><span></span><span></span> ${data.username} is typing...`;
    } else {
        indicator.style.display = 'none';
    }
}

// Отметить как прочитанное
function markAsRead(otherUserId) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'mark_read',
            userId: userId,
            otherUserId: otherUserId
        }));
    }
}

// Обновить счетчик непрочитанных
function updateUnreadCount(senderId) {
    if (currentChat.type !== 'private' || currentChat.id !== senderId) {
        const userItem = document.querySelector(`.user-item[data-user-id="${senderId}"]`);
        if (userItem) {
            const badge = userItem.querySelector('.unread-badge');
            if (badge) {
                const currentCount = parseInt(badge.textContent) || 0;
                badge.textContent = currentCount + 1;
                badge.style.display = 'inline';
            }
        }
    }
}

// Покинуть группу
window.leaveGroup = function(groupId) {
    if (confirm('Are you sure you want to leave this group?')) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'leave_group',
                userId: userId,
                groupId: groupId
            }));
        }
    }
};

// Вспомогательные функции
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function scrollToBottom() {
    const messagesDiv = document.getElementById('messages');
    if (messagesDiv) {
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}

function showNotification(message, type = 'info') {
    console.log(`${type}: ${message}`);
    // Можно заменить на красивый toast
    alert(message);
}

// Запуск
connectWebSocket();
loadPublicGroups();
startPublicChat();