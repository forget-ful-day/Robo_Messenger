# Robo Messenger

Веб-чат с:
- регистрацией/авторизацией
- личными сообщениями
- общим публичным чатом
- групповыми чатами
- удалением аккаунта

## Запуск

```bash
cd backend
npm install
npm start
```

Сервер слушает `0.0.0.0:3000`, открыть можно по:
- `http://localhost:3000`
- `http://<ваш-ip>:3000`

## Важно для Windows (ошибка sqlite3 "not a valid Win32 application")

Если видите ошибку вида:

`node_sqlite3.node is not a valid Win32 application`

значит используются бинарники `node_modules`, собранные под другую ОС/архитектуру.

Исправление:

```bash
cd backend
rmdir /s /q node_modules
if exist package-lock.json del package-lock.json
npm install
npm rebuild sqlite3
npm start
```

(в PowerShell вместо `rmdir /s /q` можно `Remove-Item -Recurse -Force node_modules`)
