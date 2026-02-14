let currentUser = null;
let ws = null;
let currentChat = null;
let currentChatType = 'private'; // 'private' или 'group'

document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }
    
    // Декодируем токен
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        currentUser = {
            id: payload.userId,
            username: payload.username
        };
        
        document.getElementById('username').textContent = currentUser.username;
        document.getElementById('userAvatar').src = `https://ui-avatars.com/api/?name=${currentUser.username}&background=667eea&color=fff`;
        
        // Подключаем WebSocket
        connectWebSocket(token);
        
        // Загружаем пользователей
        loadUsers();
        loadGroups();
    } catch (error) {
        console.error('Ошибка авторизации:', error);
        logout();
    }
});

function connectWebSocket(token) {
    ws = new WebSocket(`ws://localhost:3000?token=${token}`);
    
    ws.onopen = () => {
        console.log('WebSocket подключен');
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
            case 'new_message':
                if (currentChat === data.message.sender_id && currentChatType === 'private') {
                    displayMessage(data.message);
                }
                updateChatList();
                break;
                
            case 'new_group_message':
                if (currentChat === data.groupId && currentChatType === 'group') {
                    displayGroupMessage(data.message);
                }
                updateChatList();
                break;
                
            case 'user_status':
                updateUserStatus(data.userId, data.is_online);
                break;
                
            case 'group_joined':
                alert(`Вы присоединились к группе: ${data.group.name}`);
                loadGroups();
                break;
                
            case 'member_joined':
                if (currentChat === data.groupId) {
                    showNotification(`${data.user.username} присоединился к группе`);
                }
                break;
                
            case 'typing':
                handleTypingIndicator(data);
                break;
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket ошибка:', error);
    };
}

function loadUsers() {
    fetch('http://localhost:3000/api/users', {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    })
    .then(res => res.json())
    .then(users => {
        const chatsList = document.getElementById('chatsList');
        chatsList.innerHTML = '<h3>Пользователи</h3>';
        
        users.forEach(user => {
            const chatItem = createChatItem(user);
            chatItem.onclick = () => openPrivateChat(user);
            chatsList.appendChild(chatItem);
        });
    })
    .catch(error => {
        console.error('Ошибка загрузки пользователей:', error);
    });
}

function loadGroups() {
    fetch('http://localhost:3000/api/groups', {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    })
    .then(res => res.json())
    .then(groups => {
        const groupsContainer = document.getElementById('groupsContainer');
        groupsContainer.innerHTML = '';
        
        // Разделяем на публичные и приватные
        const publicGroups = groups.filter(g => g.type === 'public');
        const privateGroups = groups.filter(g => g.type !== 'public');
        
        if (publicGroups.length > 0) {
            const publicSection = document.createElement('div');
            publicSection.className = 'group-section';
            publicSection.innerHTML = '<h4>🌟 Общие группы</h4>';
            
            publicGroups.forEach(group => {
                const groupItem = createGroupItem(group);
                groupItem.onclick = () => openGroupChat(group);
                publicSection.appendChild(groupItem);
            });
            
            groupsContainer.appendChild(publicSection);
        }
        
        if (privateGroups.length > 0) {
            const privateSection = document.createElement('div');
            privateSection.className = 'group-section';
            privateSection.innerHTML = '<h4>🔒 Мои группы</h4>';
            
            privateGroups.forEach(group => {
                const groupItem = createGroupItem(group);
                groupItem.onclick = () => openGroupChat(group);
                privateSection.appendChild(groupItem);
            });
            
            groupsContainer.appendChild(privateSection);
        }
        
        // Добавляем кнопку создания группы
        const createBtn = document.createElement('button');
        createBtn.className = 'create-group-btn';
        createBtn.innerHTML = '+ Создать группу';
        createBtn.onclick = showCreateGroup;
        groupsContainer.appendChild(createBtn);
    })
    .catch(error => {
        console.error('Ошибка загрузки групп:', error);
    });
}

function createChatItem(user) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.setAttribute('data-user-id', user.id);
    div.innerHTML = `
        <img src="${user.avatar_url || 'https://ui-avatars.com/api/?name=' + user.username}" alt="Avatar">
        <div class="chat-info">
            <div class="chat-name">
                ${user.username}
                <span class="online-status ${user.is_online ? 'online' : ''}"></span>
            </div>
            <div class="chat-status">${user.is_online ? 'Онлайн' : 'Офлайн'}</div>
        </div>
    `;
    return div;
}

function createGroupItem(group) {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.setAttribute('data-group-id', group.id);
    
    const status = group.is_member ? 'Участник' : 'Публичная группа';
    const joinButton = !group.is_member && group.type === 'public' ? 
        '<button class="join-group-btn" onclick="event.stopPropagation(); joinGroup(' + group.id + ')">Вступить</button>' : '';
    
    div.innerHTML = `
        <img src="${group.avatar_url}" alt="Group">
        <div class="chat-info">
            <div class="chat-name">
                ${group.name}
                ${group.type === 'public' ? '🌟' : '🔒'}
            </div>
            <div class="chat-status">
                ${group.members_count} участников • ${status}
            </div>
            ${joinButton}
        </div>
    `;
    
    if (group.is_member) {
        div.onclick = () => openGroupChat(group);
    }
    
    return div;
}

function joinGroup(groupId) {
    fetch(`http://localhost:3000/api/groups/${groupId}/join`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            loadGroups();
            showNotification('Вы успешно присоединились к группе!');
        }
    })
    .catch(error => {
        console.error('Ошибка присоединения к группе:', error);
    });
}

function openPrivateChat(user) {
    currentChat = user.id;
    currentChatType = 'private';
    
    document.getElementById('chatHeader').innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <img src="${user.avatar_url}" alt="Avatar" style="width: 40px; height: 40px; border-radius: 50%;">
            <div>
                <h2>${user.username}</h2>
                <span class="online-status ${user.is_online ? 'online' : ''}"></span>
                ${user.is_online ? 'Онлайн' : 'Офлайн'}
            </div>
        </div>
    `;
    
    document.querySelector('.message-input').style.display = 'flex';
    
    // Загружаем историю сообщений
    fetch(`http://localhost:3000/api/messages/${user.id}`, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    })
    .then(res => res.json())
    .then(messages => {
        const messagesContainer = document.getElementById('messages');
        messagesContainer.innerHTML = '';
        
        messages.forEach(msg => {
            displayMessage(msg);
        });
        
        scrollToBottom();
    });
    
    // Подсвечиваем активный чат
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
}

function openGroupChat(group) {
    currentChat = group.id;
    currentChatType = 'group';
    
    document.getElementById('chatHeader').innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <img src="${group.avatar_url}" alt="Group" style="width: 40px; height: 40px; border-radius: 50%;">
            <div>
                <h2>${group.name} ${group.type === 'public' ? '🌟' : '🔒'}</h2>
                <p style="font-size: 14px; color: #666;">${group.description || ''}</p>
            </div>
        </div>
        <button onclick="showGroupMembers(${group.id})" class="members-btn">Участники</button>
    `;
    
    document.querySelector('.message-input').style.display = 'flex';
    
    // Загружаем историю сообщений группы
    fetch(`http://localhost:3000/api/groups/${group.id}/messages`, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    })
    .then(res => res.json())
    .then(messages => {
        const messagesContainer = document.getElementById('messages');
        messagesContainer.innerHTML = '';
        
        messages.forEach(msg => {
            displayGroupMessage(msg);
        });
        
        scrollToBottom();
    });
    
    // Подсвечиваем активный чат
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    event.currentTarget.classList.add('active');
}

function showGroupMembers(groupId) {
    fetch(`http://localhost:3000/api/groups/${groupId}/members`, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    })
    .then(res => res.json())
    .then(members => {
        const membersList = members.map(m => 
            `${m.username} ${m.role === 'admin' ? '👑' : ''} ${m.is_online ? '🟢' : '⚫'}`
        ).join('\n');
        
        alert('Участники группы:\n' + membersList);
    });
}

function displayMessage(message) {
    const messagesContainer = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.sender_id === currentUser.id ? 'own' : ''}`;
    
    messageDiv.innerHTML = `
        <div class="message-content">${escapeHtml(message.message)}</div>
        <div class="message-info">
            <span>${new Date(message.created_at).toLocaleTimeString()}</span>
        </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

function displayGroupMessage(message) {
    const messagesContainer = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.sender_id === currentUser.id ? 'own' : ''}`;
    
    messageDiv.innerHTML = `
        <div class="message-content">
            ${message.sender_id !== currentUser.id ? 
                `<strong style="color: #667eea;">${escapeHtml(message.username)}</strong><br>` : ''}
            ${escapeHtml(message.message)}
        </div>
        <div class="message-info">
            <span>${new Date(message.created_at).toLocaleTimeString()}</span>
        </div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

function sendMessage() {
    const input = document.getElementById('messageText');
    const message = input.value.trim();
    
    if (!message || !currentChat) return;
    
    if (currentChatType === 'private') {
        fetch('http://localhost:3000/api/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                receiverId: currentChat,
                message: message
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                displayMessage({
                    sender_id: currentUser.id,
                    message: message,
                    created_at: new Date().toISOString()
                });
                input.value = '';
            }
        });
    } else {
        fetch(`http://localhost:3000/api/groups/${currentChat}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                message: message
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                displayGroupMessage({
                    sender_id: currentUser.id,
                    username: currentUser.username,
                    message: message,
                    created_at: new Date().toISOString()
                });
                input.value = '';
            }
        });
    }
}

function showCreateGroup() {
    const modal = document.getElementById('createGroupModal');
    modal.style.display = 'flex';
    
    // Заполняем форму
    document.getElementById('groupName').value = '';
    document.getElementById('groupDescription').value = '';
    document.getElementById('groupType').value = 'private';
}

function closeModal() {
    document.getElementById('createGroupModal').style.display = 'none';
}

function createGroup() {
    const name = document.getElementById('groupName').value;
    const description = document.getElementById('groupDescription').value;
    const type = document.getElementById('groupType').value;
    
    if (!name) {
        alert('Введите название группы');
        return;
    }
    
    fetch('http://localhost:3000/api/groups', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ name, description, type })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            closeModal();
            loadGroups();
            showNotification('Группа успешно создана!');
        }
    })
    .catch(error => {
        console.error('Ошибка создания группы:', error);
        alert('Ошибка создания группы');
    });
}

function updateUserStatus(userId, isOnline) {
    const chatItem = document.querySelector(`.chat-item[data-user-id="${userId}"]`);
    if (chatItem) {
        const statusDot = chatItem.querySelector('.online-status');
        const statusText = chatItem.querySelector('.chat-status');
        
        if (statusDot) {
            statusDot.className = `online-status ${isOnline ? 'online' : ''}`;
        }
        if (statusText) {
            statusText.textContent = isOnline ? 'Онлайн' : 'Офлайн';
        }
    }
}

function updateChatList() {
    // Обновляем списки чатов при новых сообщениях
    if (document.getElementById('chatsList').style.display !== 'none') {
        loadUsers();
    } else {
        loadGroups();
    }
}

function handleTypingIndicator(data) {
    // Показываем индикатор печатания
    const typingDiv = document.getElementById('typingIndicator');
    if (data.isTyping) {
        if (typingDiv) {
            typingDiv.textContent = `${data.username} печатает...`;
            typingDiv.style.display = 'block';
        }
    } else {
        if (typingDiv) {
            typingDiv.style.display = 'none';
        }
    }
}

function showNotification(message) {
    // Создаем временное уведомление
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #667eea;
        color: white;
        padding: 15px 20px;
        border-radius: 5px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function deleteAccount() {
    if (confirm('Вы уверены, что хотите удалить аккаунт? Это действие нельзя отменить.')) {
        fetch('http://localhost:3000/api/users/me', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        })
        .then(res => res.json())
        .then(() => {
            logout();
        });
    }
}

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    if (tab === 'chats') {
        document.getElementById('chatsList').style.display = 'block';
        document.getElementById('groupsList').style.display = 'none';
        loadUsers();
    } else {
        document.getElementById('chatsList').style.display = 'none';
        document.getElementById('groupsList').style.display = 'block';
        loadGroups();
    }
}

function logout() {
    localStorage.removeItem('token');
    window.location.href = 'login.html';
}

function scrollToBottom() {
    const messages = document.getElementById('messages');
    messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Поиск пользователей
document.getElementById('searchInput')?.addEventListener('input', (e) => {
    const query = e.target.value;
    
    if (query.length < 2) {
        loadUsers();
        return;
    }
    
    fetch(`http://localhost:3000/api/search/users?q=${query}`, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
    })
    .then(res => res.json())
    .then(users => {
        const chatsList = document.getElementById('chatsList');
        chatsList.innerHTML = '<h3>Результаты поиска</h3>';
        
        users.forEach(user => {
            const chatItem = createChatItem(user);
            chatItem.onclick = () => openPrivateChat(user);
            chatsList.appendChild(chatItem);
        });
    });
});

// Отправка по Enter
document.getElementById('messageText')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Индикатор печатания
let typingTimer;
document.getElementById('messageText')?.addEventListener('input', (e) => {
    if (!currentChat || currentChatType !== 'private') return;
    
    clearTimeout(typingTimer);
    
    // Отправляем сигнал о печатании
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'typing',
            receiverId: currentChat,
            isTyping: true
        }));
    }
    
    typingTimer = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'typing',
                receiverId: currentChat,
                isTyping: false
            }));
        }
    }, 1000);
});