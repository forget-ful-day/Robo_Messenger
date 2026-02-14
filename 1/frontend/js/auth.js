const API_URL = 'http://localhost:3000/api';

// Load avatars for registration
if (document.getElementById('avatarSelector')) {
    fetch(`${API_URL}/avatars`)
        .then(response => response.json())
        .then(avatars => {
            const selector = document.getElementById('avatarSelector');
            avatars.forEach(avatar => {
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
}

// Handle registration
if (document.getElementById('registerForm')) {
    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        if (password !== confirmPassword) {
            alert('Passwords do not match');
            return;
        }
        
        // Get selected avatar
        const selectedAvatar = document.querySelector('.avatar-option.selected');
        const avatar = selectedAvatar ? selectedAvatar.dataset.avatar : '😊';
        
        try {
            const response = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password, avatar })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('userId', data.id);
                localStorage.setItem('username', data.username);
                localStorage.setItem('avatar', data.avatar);
                window.location.href = 'chat.html';
            } else {
                alert(data.error || 'Registration failed');
            }
        } catch (error) {
            console.error('Registration error:', error);
            alert('Registration failed. Please try again.');
        }
    });
}

// Handle login
if (document.getElementById('loginForm')) {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        try {
            const response = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('userId', data.id);
                localStorage.setItem('username', data.username);
                localStorage.setItem('avatar', data.avatar);
                window.location.href = 'chat.html';
            } else {
                alert(data.error || 'Login failed');
            }
        } catch (error) {
            console.error('Login error:', error);
            alert('Login failed. Please try again.');
        }
    });
}