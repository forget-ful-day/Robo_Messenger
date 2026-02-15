const API_URL = `http://${window.location.hostname}:3000/api`;
const token = localStorage.getItem('token');
const userId = localStorage.getItem('userId');
const username = localStorage.getItem('username');

if (!token || !userId || !username) {
    window.location.href = 'login.html';
}

const currentAvatar = document.getElementById('currentAvatar');
const profileUsername = document.getElementById('profileUsername');
if (currentAvatar) currentAvatar.textContent = localStorage.getItem('avatar') || '😊';
if (profileUsername) profileUsername.textContent = username;

const deleteBtn = document.getElementById('deleteAccountBtn');
if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
        document.getElementById('confirmModal')?.classList.add('show');
    });
}

const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async () => {
        try {
            const response = await fetch(`${API_URL}/delete-account`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();
            if (response.ok && data.success) {
                localStorage.clear();
                window.location.href = 'index.html';
                return;
            }

            alert(data.error || 'Failed to delete account');
        } catch (error) {
            alert('Failed to delete account');
        }
    });
}

function closeModal() {
    document.getElementById('confirmModal')?.classList.remove('show');
}

window.closeModal = closeModal;
