const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// ============ ИГРОВЫЕ ДАННЫЕ ============
let players = {};
let bullets = [];
let bulletId = 0;

const MAP_WIDTH = 1280;
const MAP_HEIGHT = 1280;
const TANK_SIZE = 35;
const BULLET_SPEED = 12;
const SHOT_COOLDOWN = 400;
const BULLET_LIFETIME = 2000;

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function getPlayerList() {
    const result = {};
    for (let id in players) {
        const p = players[id];
        result[id] = {
            id: p.id,
            name: p.name || 'Player',
            x: p.x || 500,
            y: p.y || 500,
            rotation: p.rotation || 0,
            turretRotation: p.turretRotation || 0,
            hp: p.hp || 100,
            score: p.score || 0,
            alive: p.alive !== false,
            skin: p.skin || 'red',
            tank: p.tank || 't34',
            rank: p.rank || 'Новичок',
            verified: p.verified || false,
            lastSeen: Date.now()
        };
    }
    return result;
}

// ============ ОБРАБОТКА ПУЛЬ ============
function updateBullets() {
    const now = Date.now();
    let updated = false;

    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        
        // Удаляем старые пули
        if (now - b.createdAt > BULLET_LIFETIME) {
            bullets.splice(i, 1);
            updated = true;
            continue;
        }

        // Движение пули
        b.x += b.vx;
        b.y += b.vy;

        // Проверка границ карты
        if (b.x < 0 || b.x > MAP_WIDTH || b.y < 0 || b.y > MAP_HEIGHT) {
            bullets.splice(i, 1);
            updated = true;
            continue;
        }

        // Проверка попаданий в игроков
        let hit = false;
        for (let id in players) {
            const p = players[id];
            if (!p || !p.alive || id === b.ownerId) continue;
            
            const dx = b.x - p.x;
            const dy = b.y - p.y;
            if (Math.sqrt(dx * dx + dy * dy) < TANK_SIZE / 2) {
                // Попадание!
                const damage = b.damage || 25;
                p.hp = (p.hp || 100) - damage;
                
                if (p.hp <= 0) {
                    p.hp = 0;
                    p.alive = false;
                    // Даем очко стрелку
                    if (players[b.ownerId]) {
                        players[b.ownerId].score = (players[b.ownerId].score || 0) + 1;
                    }
                }
                
                // Удаляем пулю
                bullets.splice(i, 1);
                updated = true;
                hit = true;
                
                // Рассылаем обновление игроков
                broadcast({ type: 'update', players: getPlayerList() });
                break;
            }
        }
    }

    if (updated) {
        // Отправляем только ID и позиции пуль (для экономии трафика)
        const bulletData = bullets.map(b => ({ id: b.id, x: b.x, y: b.y }));
        broadcast({ type: 'bullets', bullets: bulletData });
    }
}

// ============ WEBSOCKET СОЕДИНЕНИЯ ============
wss.on('connection', (ws) => {
    // Генерируем ID для нового игрока
    const playerId = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    
    // Создаем игрока со стартовыми координатами
    const spawnX = 100 + Math.random() * (MAP_WIDTH - 200);
    const spawnY = 100 + Math.random() * (MAP_HEIGHT - 200);
    
    players[playerId] = {
        id: playerId,
        name: 'Player',
        x: spawnX,
        y: spawnY,
        rotation: 0,
        turretRotation: 0,
        hp: 100,
        score: 0,
        alive: true,
        skin: 'red',
        tank: 't34',
        rank: 'Новичок',
        verified: false,
        lastSeen: Date.now()
    };

    console.log(`✅ Игрок ${playerId} подключился`);

    // Отправляем новому игроку его ID и список всех игроков
    ws.send(JSON.stringify({
        type: 'init',
        id: playerId,
        players: getPlayerList()
    }));

    // Рассылаем всем обновленный список игроков
    broadcast({ type: 'update', players: getPlayerList() });

    // ============ ОБРАБОТКА СООБЩЕНИЙ ОТ КЛИЕНТА ============
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(playerId, data, ws);
        } catch (e) {
            console.error('❌ Ошибка парсинга:', e);
        }
    });

    // ============ ОБРАБОТКА ОТКЛЮЧЕНИЯ ============
    ws.on('close', () => {
        console.log(`❌ Игрок ${playerId} отключился`);
        delete players[playerId];
        broadcast({ type: 'remove', id: playerId });
        broadcast({ type: 'update', players: getPlayerList() });
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket ошибка:', error);
    });
});

// ============ ОБРАБОТЧИК СООБЩЕНИЙ ============
function handleMessage(playerId, data, ws) {
    const player = players[playerId];
    if (!player) return;

    switch (data.type) {
        case 'join':
            // Обновляем данные игрока при входе
            player.name = data.name || 'Player';
            player.skin = data.skin || 'red';
            player.tank = data.tank || 't34';
            player.rank = data.rank || 'Новичок';
            player.verified = data.verified || false;
            broadcast({ type: 'update', players: getPlayerList() });
            break;

        case 'move':
            // Обновляем позицию игрока
            if (player.alive) {
                player.x = data.x || player.x;
                player.y = data.y || player.y;
                player.rotation = data.rotation || 0;
                player.turretRotation = data.turretRotation || 0;
                player.hp = data.hp || 100;
                player.alive = data.alive !== false;
                player.name = data.name || player.name;
                player.skin = data.skin || player.skin;
                player.tank = data.tank || player.tank;
                player.rank = data.rank || player.rank;
                player.verified = data.verified || player.verified;
                player.score = data.score || player.score;
                player.lastSeen = Date.now();
                
                // Рассылаем обновление всем (кроме отправителя, чтобы сэкономить трафик)
                const updateData = { type: 'update', players: getPlayerList() };
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && client !== ws) {
                        client.send(JSON.stringify(updateData));
                    }
                });
            }
            break;

        case 'shoot':
            // Обработка выстрела
            if (player.alive) {
                const now = Date.now();
                if (now - (player.lastShot || 0) < SHOT_COOLDOWN) return;
                player.lastShot = now;

                const angle = data.angle || player.turretRotation;
                const damage = data.damage || 25;
                const bx = player.x + Math.cos(angle) * (TANK_SIZE / 2 + 5);
                const by = player.y + Math.sin(angle) * (TANK_SIZE / 2 + 5);

                const bullet = {
                    id: bulletId++,
                    x: bx,
                    y: by,
                    vx: Math.cos(angle) * BULLET_SPEED,
                    vy: Math.sin(angle) * BULLET_SPEED,
                    ownerId: playerId,
                    damage: damage,
                    createdAt: now
                };
                bullets.push(bullet);
                
                // Отправляем пулю всем
                broadcast({ 
                    type: 'bullet', 
                    bullet: { id: bullet.id, x: bullet.x, y: bullet.y, ownerId: bullet.ownerId } 
                });
            }
            break;

        case 'chat':
            // Чат
            broadcast({
                type: 'chat',
                name: player.name,
                message: data.message || '',
                verified: player.verified || false
            });
            break;

        case 'ping':
            // Проверка соединения
            ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
            break;
    }
}

// ============ ОБНОВЛЕНИЕ ПУЛЬ ============
setInterval(updateBullets, 50);

// ============ ОЧИСТКА МЕРТВЫХ ИГРОКОВ ============
setInterval(() => {
    const now = Date.now();
    let changed = false;
    
    for (let id in players) {
        const p = players[id];
        if (p.lastSeen && (now - p.lastSeen > 30000)) {
            // Игрок не отвечал 30 секунд — удаляем
            delete players[id];
            changed = true;
            console.log(`⏰ Игрок ${id} удален за таймаут`);
        }
    }
    
    if (changed) {
        broadcast({ type: 'update', players: getPlayerList() });
    }
}, 15000);

// ============ ЗАПУСК СЕРВЕРА ============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📊 Карта: ${MAP_WIDTH}x${MAP_HEIGHT}`);
    console.log(`👥 Максимум игроков: безлимит`);
});

// ============ ОБРАБОТКА ЗАВЕРШЕНИЯ ============
process.on('SIGINT', () => {
    console.log('🛑 Сервер остановлен');
    process.exit();
});