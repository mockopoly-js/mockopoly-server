import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { registerRoomHandlers } from './socket/roomHandlers';
import { registerGameHandlers } from './socket/gameHandlers';
import { registerTradeHandlers } from './socket/tradeHandlers';
import { registerPartnershipHandlers } from './socket/partnershipHandlers';
import { registerDealHandlers } from './socket/dealHandlers';
import { registerDevHandlers } from './socket/devHandlers';
import { gameManager } from './game/GameManager';

const app = express();
const httpServer = createServer(app);

const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    rooms: gameManager.roomCount,
  });
});

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  registerRoomHandlers(io, socket);
  registerGameHandlers(io, socket);
  registerTradeHandlers(io, socket);
  registerPartnershipHandlers(io, socket);
  registerDealHandlers(io, socket);
  registerDevHandlers(io, socket);
});

// Periodic cleanup of idle rooms (every 10 minutes)
setInterval(() => {
  const removed = gameManager.cleanupIdleRooms();
  if (removed > 0) {
    console.log(`[cleanup] Removed ${removed} idle room(s). Active: ${gameManager.roomCount}`);
  }
}, 10 * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`🎲 Mockopoly server running on http://localhost:${PORT}`);
});
