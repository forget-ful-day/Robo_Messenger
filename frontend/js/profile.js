const API_URL = 'http://localhost:3000/api';
const token = localStorage.getItem('token');
const userId = localStorage.getItem('userId');
const username = localStorage.getItem('username');

if (!token || !userId || !username) {
    window.location.href = 'login.html';
}

// Load current avatar
document.getElementById('currentAvatar').textContent = localStorage.getItem('avatar') || '😊';
document.getElementById('profileUsername').textContent = username;

// Load avatars
fetch(`${API_URL}/avatars`)
    .then(response => response.json())
    .then(avatars => {
        const grid = document.getElementById('avatarGrid');
        avatars.forEach(avatar => {
            const div = document.createElement('div');
            div.className = 'avatar-option';
            div.textContent = avatar;
            div.addEventListener('click', () => updateAvatar(avatar));
            grid.appendChild(div);
        });
    });

// Load custom emojis
loadCustomEmojis();

function loadCustomEmojis() {
    fetch(`${API_URL}/custom-emojis/${userId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(response => response.json())
    .then(emojis => {
        const list = document.getElementById('customEmojisList');
        list.innerHTML = '';
        
        if (emojis.length === 0) {
            list.innerHTML = '<p class="no-emojis">No custom emojis yet</p>';
            return;
        }
        
        emojis.forEach(emoji => {
            const div = document.createElement('div');
            div.className = 'custom-emoji-item';
            div.innerHTML = `
                <span class="emoji-char">${emoji.emoji}</span>
                <span class="emoji-name">:${emoji.name}:</span>
            `;
            list.appendChild(div);
        });
    });
}

function updateAvatar(avatar) {
    fetch(`${API_URL}/update-avatar`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId: parseInt(userId), avatar })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            localStorage.setItem('avatar', avatar);
            document.getElementById('currentAvatar').textContent = avatar;
            showNotification('Avatar updated successfully');
        }
    });
}

// Add custom emoji
document.getElementById('addEmojiBtn').addEventListener('click', () => {
    const name = document.getElementById('emojiName').value.trim();
    const emoji = document.getElementById('emojiChar').value.trim();
    
    if (!name || !emoji) {
        alert('Please enter both name and emoji');
        return;
    }
    
    fetch(`${API_URL}/add-custom-emoji`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId: parseInt(userId), name, emoji })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            document.getElementById('emojiName').value = '';
            document.getElementById('emojiChar').value = '';
            loadCustomEmojis();
            showNotification('Custom emoji added successfully');
        } else {
            alert(data.error || 'Failed to add emoji');
        }
    });
});

// Delete account
document.getElementById('deleteAccountBtn').addEventListener('click', () => {
    document.getElementById('confirmModal').classList.add('show');
});

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
    const ws = new WebSocket(`ws://localhost:3000`);
    
    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'delete_account',
            userId: parseInt(userId),
            username: username
        }));
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'account_deleted') {
            localStorage.clear();
            window.location.href = 'index.html';
        }
    };
});

function closeModal() {
    document.getElementById('confirmModal').classList.remove('show');
}

function showNotification(message) {
    // You can implement a toast notification here
    alert(message);
}