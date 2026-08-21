const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const social = require('./social');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const clientPath = path.join(__dirname, '..', 'client');

app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use('/api', social);
app.use(express.static(clientPath));
app.get('/health', (_req, res) => res.json({ ok: true }));

io.on('connection', socket => {
  socket.on('join-room', ({ roomId, name }) => {
    roomId = String(roomId || '').trim().slice(0, 40);
    name = String(name || 'Usuário').trim().slice(0, 24);
    if (!roomId) return;
    socket.data = { roomId, name };
    socket.join(roomId);
    const others = [...(io.sockets.adapter.rooms.get(roomId) || [])]
      .filter(id => id !== socket.id)
      .map(id => ({ id, name: io.sockets.sockets.get(id)?.data?.name || 'Usuário' }));
    socket.emit('room-users', others);
    socket.to(roomId).emit('user-joined', { id: socket.id, name });
  });

  socket.on('signal', ({ to, data }) => io.to(to).emit('signal', { from: socket.id, data }));
  socket.on('chat-message', text => {
    if (!socket.data.roomId) return;
    io.to(socket.data.roomId).emit('chat-message', {
      id: socket.id, name: socket.data.name, text: String(text || '').slice(0, 1000), time: Date.now()
    });
  });
  socket.on('media-state', state => socket.data.roomId && socket.to(socket.data.roomId).emit('media-state', { id: socket.id, ...state }));
  socket.on('disconnect', () => socket.data.roomId && socket.to(socket.data.roomId).emit('user-left', socket.id));
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Lunarcord server: http://localhost:${port}`));
