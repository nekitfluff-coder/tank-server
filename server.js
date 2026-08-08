const WebSocket = require('ws');
const server = new WebSocket.Server({ port: process.env.PORT || 3000 });

let players = {};

server.on('connection', (ws) => {
    const id = Date.now() + '_' + Math.random();
    players[id] = { x: 0, y: 0, rotation: 0 };

    ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        if (data.type === 'move') {
            players[id] = data;
            broadcast(JSON.stringify({ type: 'update', players }));
        }
    });

    ws.on('close', () => {
        delete players[id];
        broadcast(JSON.stringify({ type: 'remove', id }));
    });
});

function broadcast(data) {
    server.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

console.log('🚀 Сервер запущен на порту ' + (process.env.PORT || 3000));