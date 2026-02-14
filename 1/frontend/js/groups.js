const API_URL = 'http://localhost:3000/api';
const token = localStorage.getItem('token');
const userId = localStorage.getItem('userId');

if (!token || !userId) {
    window.location.href = 'login.html';
}

// Load avatars
fetch(`${API_URL}/avatars`)
    .then(response => response.json())
    .then(avatars => {
        const selector = document.getElementById('avatarSelector');
        avatars.slice(0, 12).forEach(avatar => {
            const div = document.createElement('div');
            div.className = 'avatar-option';
            div.textContent = avatar;
            div.dataset.avatar = avatar;
            div.addEventListener('click', () => {
                document.querySelectorAll('.avatar-option').forEach(opt => opt.classList.remove('selected'));
                div.classList.add('selected');
            });
            selector.appendChild(div);
        });
        
        // Select first avatar by default
        if (selector.firstChild) {
            selector.firstChild.classList.add('selected');
        }
    });

// Handle group creation
document.getElementById('createGroupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    
    const name = document.getElementById('groupName').value;
    const description = document.getElementById('groupDescription').value;
    const isPrivate = document.getElementById('isPrivate').checked;
    const selectedAvatar = document.querySelector('.avatar-option.selected');
    const avatar = selectedAvatar ? selectedAvatar.dataset.avatar : '👥';
    
    const ws = new WebSocket(`ws://localhost:3000`);
    
    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'create_group',
            userId: parseInt(userId),
            name,
            description,
            avatar,
            isPrivate
        }));
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'group_created') {
            window.location.href = 'chat.html';
        } else if (data.type === 'error') {
            alert(data.message);
        }
    };
});