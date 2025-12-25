// Основной файл приложения Робо Мессенджер
document.addEventListener('DOMContentLoaded', function() {
    // Элементы DOM
    const loginBtn = document.getElementById('login-btn');
    const loginModal = document.getElementById('login-modal');
    const loginSubmitBtn = document.getElementById('login-submit');
    const loginCancelBtn = document.getElementById('login-cancel');
    const usernameInput = document.getElementById('login-username');
    const usernameDisplay = document.getElementById('username');
    const newChatBtn = document.getElementById('new-chat-btn');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const messagesContainer = document.getElementById('messages-container');
    
    // Текущий пользователь
    let currentUser = localStorage.getItem('robomessenger_user') || 'Гость';
    let currentContact = 'Робот-помощник';
    
    // Инициализация
    function init() {
        // Установка имени пользователя
        usernameDisplay.textContent = currentUser;
        
        // Если пользователь не вошел, показываем модальное окно
        if (currentUser === 'Гость') {
            setTimeout(() => {
                loginModal.classList.add('active');
            }, 500);
        }
        
        // Загрузка контактов
        loadContacts();
        
        // Загрузка сообщений
        loadMessages();
        
        // Установка обработчиков событий
        setupEventListeners();
        
        // Имитация ответов робота
        setupRobotResponses();
    }
    
    // Настройка обработчиков событий
    function setupEventListeners() {
        // Кнопка входа
        loginBtn.addEventListener('click', () => {
            loginModal.classList.add('active');
        });
        
        // Отправка формы входа
        loginSubmitBtn.addEventListener('click', () => {
            const username = usernameInput.value.trim();
            if (username) {
                currentUser = username;
                usernameDisplay.textContent = username;
                localStorage.setItem('robomessenger_user', username);
                loginModal.classList.remove('active');
                showNotification(`Добро пожаловать, ${username}!`);
                
                // Отправляем приветственное сообщение от робота
                setTimeout(() => {
                    addMessage('Робот-помощник', `Привет, ${username}! Рад тебя видеть. Чем могу помочь?`, 'received');
                }, 1000);
            } else {
                alert('Пожалуйста, введите имя пользователя');
            }
        });
        
        // Отмена входа
        loginCancelBtn.addEventListener('click', () => {
            loginModal.classList.remove('active');
        });
        
        // Отправка сообщения по нажатию Enter
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
        
        // Отправка сообщения по клику на кнопку
        sendBtn.addEventListener('click', sendMessage);
        
        // Новая кнопка чата
        newChatBtn.addEventListener('click', () => {
            const contactName = prompt('Введите имя нового контакта:');
            if (contactName && contactName.trim()) {
                addContact(contactName.trim());
            }
        });
        
        // Поиск контактов
        const contactSearch = document.getElementById('contact-search');
        contactSearch.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            filterContacts(searchTerm);
        });
    }
    
    // Загрузка контактов
    function loadContacts() {
        // Здесь обычно будет запрос к серверу
        // Пока используем заглушку
        const contacts = [
            { id: 1, name: 'Робот-помощник', lastMessage: 'Привет! Я ваш помощник', time: '12:00', online: true },
            { id: 2, name: 'Анна', lastMessage: 'Привет! Как дела?', time: '11:45', online: true },
            { id: 3, name: 'Иван', lastMessage: 'Отправлю файлы позже', time: '10:30', online: false },
            { id: 4, name: 'Мария', lastMessage: 'Спасибо за помощь!', time: '09:15', online: true },
            { id: 5, name: 'Алексей', lastMessage: 'До встречи завтра', time: 'Вчера', online: false }
        ];
        
        const contactList = document.getElementById('contact-list');
        contactList.innerHTML = '';
        
        contacts.forEach(contact => {
            const contactElement = createContactElement(contact);
            contactList.appendChild(contactElement);
            
            // Обработчик клика по контакту
            contactElement.addEventListener('click', () => {
                setActiveContact(contact.name, contact.online);
            });
        });
    }
    
    // Создание элемента контакта
    function createContactElement(contact) {
        const contactElement = document.createElement('div');
        contactElement.className = 'contact-item';
        if (contact.name === 'Робот-помощник') {
            contactElement.classList.add('active');
        }
        
        contactElement.innerHTML = `
            <div class="contact-avatar">
                <i class="fas fa-${contact.name === 'Робот-помощник' ? 'robot' : 'user'}"></i>
            </div>
            <div class="contact-info">
                <h3>${contact.name}</h3>
                <p>${contact.lastMessage}</p>
            </div>
            <div class="contact-time">${contact.time}</div>
        `;
        
        return contactElement;
    }
    
    // Добавление нового контакта
    function addContact(name) {
        const contactList = document.getElementById('contact-list');
        
        const contact = {
            id: Date.now(),
            name: name,
            lastMessage: 'Нет сообщений',
            time: 'Только что',
            online: true
        };
        
        const contactElement = createContactElement(contact);
        contactList.prepend(contactElement);
        
        // Обработчик клика по новому контакту
        contactElement.addEventListener('click', () => {
            setActiveContact(contact.name, contact.online);
        });
        
        showNotification(`Контакт ${name} добавлен`);
    }
    
    // Фильтрация контактов
    function filterContacts(searchTerm) {
        const contactItems = document.querySelectorAll('.contact-item');
        
        contactItems.forEach(item => {
            const contactName = item.querySelector('h3').textContent.toLowerCase();
            if (contactName.includes(searchTerm) || searchTerm === '') {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        });
    }
    
    // Установка активного контакта
    function setActiveContact(contactName, isOnline) {
        currentContact = contactName;
        
        // Обновляем заголовок чата
        document.getElementById('current-contact-name').textContent = contactName;
        document.getElementById('contact-status').textContent = isOnline ? 'в сети' : 'не в сети';
        
        // Обновляем активный элемент в списке контактов
        document.querySelectorAll('.contact-item').forEach(item => {
            item.classList.remove('active');
            if (item.querySelector('h3').textContent === contactName) {
                item.classList.add('active');
            }
        });
        
        // Очищаем и загружаем сообщения для этого контакта
        messagesContainer.innerHTML = '';
        loadMessages();
        
        // Прокручиваем к последнему сообщению
        scrollToBottom();
    }
    
    // Загрузка сообщений
    function loadMessages() {
        // Здесь обычно будет запрос к серверу
        // Пока используем заглушку с начальными сообщениями
        if (currentContact === 'Робот-помощник') {
            addMessage('Робот-помощник', 'Привет! Я ваш робот-помощник. Как я могу вам помочь?', 'received');
        } else {
            addMessage(currentContact, `Привет! Это ${currentContact}.`, 'received');
        }
    }
    
    // Отправка сообщения
    function sendMessage() {
        const messageText = messageInput.value.trim();
        
        if (messageText === '') return;
        
        // Добавляем сообщение от пользователя
        addMessage(currentUser, messageText, 'sent');
        
        // Очищаем поле ввода
        messageInput.value = '';
        
        // Фокус на поле ввода
        messageInput.focus();
        
        // Обновляем последнее сообщение в списке контактов
        updateLastMessage(currentContact, messageText);
        
        // Имитация ответа робота (если это чат с роботом)
        if (currentContact === 'Робот-помощник') {
            setTimeout(() => {
                generateRobotResponse(messageText);
            }, 1000 + Math.random() * 2000);
        }
    }
    
    // Добавление сообщения в чат
    function addMessage(sender, text, type) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        
        // Форматирование времени
        const now = new Date();
        const timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        
        messageElement.innerHTML = `
            <div class="message-content">
                <p>${escapeHtml(text)}</p>
            </div>
            <div class="message-time">${timeString}</div>
        `;
        
        messagesContainer.appendChild(messageElement);
        
        // Прокручиваем к новому сообщению
        scrollToBottom();
    }
    
    // Обновление последнего сообщения в контакте
    function updateLastMessage(contactName, message) {
        const contactItems = document.querySelectorAll('.contact-item');
        
        contactItems.forEach(item => {
            if (item.querySelector('h3').textContent === contactName) {
                const lastMessageElement = item.querySelector('p');
                lastMessageElement.textContent = message.length > 30 ? message.substring(0, 30) + '...' : message;
                
                // Обновляем время
                const now = new Date();
                const timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                item.querySelector('.contact-time').textContent = timeString;
            }
        });
    }
    
    // Настройка ответов робота
    function setupRobotResponses() {
        // Здесь можно добавить логику для интеллектуальных ответов робота
    }
    
    // Генерация ответа робота
    function generateRobotResponse(userMessage) {
        const responses = [
            "Интересный вопрос! Дайте мне подумать...",
            "Я понял ваш запрос. Что еще вы хотели бы узнать?",
            "Спасибо за сообщение! Как я могу помочь вам еще?",
            "Это хороший вопрос. Возможно, я могу помочь вам с этим.",
            "Я запомнил эту информацию. Что еще вас интересует?",
            "Понял! У меня есть информация по этой теме. Хотите узнать больше?",
            "Интересно! У меня есть кое-что по этому поводу.",
            "Спасибо, что поделились! Могу я чем-то помочь?"
        ];
        
        // Простой анализ сообщения
        const message = userMessage.toLowerCase();
        let response;
        
        if (message.includes('привет') || message.includes('здравствуй')) {
            response = `Привет, ${currentUser}! Рад тебя видеть снова!`;
        } else if (message.includes('как дела') || message.includes('как ты')) {
            response = "У меня всё отлично! Готов помогать вам с любыми вопросами.";
        } else if (message.includes('спасибо')) {
            response = "Всегда пожалуйста! Обращайтесь, если нужна помощь.";
        } else if (message.includes('пока') || message.includes('до свидания')) {
            response = "До свидания! Буду ждать ваших сообщений.";
        } else if (message.includes('помощь') || message.includes('помоги')) {
            response = "Конечно! Я могу помочь с различными вопросами. Просто задайте свой вопрос, и я постараюсь помочь.";
        } else if (message.includes('время') || message.includes('дата')) {
            const now = new Date();
            const dateString = now.toLocaleDateString('ru-RU', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            const timeString = now.toLocaleTimeString('ru-RU');
            response = `Сегодня ${dateString}. Сейчас ${timeString}.`;
        } else {
            // Случайный ответ из общего списка
            response = responses[Math.floor(Math.random() * responses.length)];
        }
        
        addMessage('Робот-помощник', response, 'received');
    }
    
    // Прокрутка вниз
    function scrollToBottom() {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    // Показать уведомление
    function showNotification(message) {
        // В реальном приложении здесь можно использовать Toast-уведомления
        console.log(`Уведомление: ${message}`);
    }
    
    // Экранирование HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Запуск приложения
    init();
});