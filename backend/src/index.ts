import http from 'http';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import OpenAI from 'openai';
import { z } from 'zod';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3001', 10);
const DB_PATH = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DB_PATH, 'lobby.db');

fs.mkdirSync(DB_PATH, { recursive: true });

const db = new Database(DB_FILE);
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lobbyCode TEXT NOT NULL,
    sender TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )
`);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

type LobbyData = {
  code: string;
  openaiKey?: string;
};

const lobbies = new Map<string, LobbyData>();
const lobbyUsers = new Map<string, Map<string, string>>();
const socketToLobby = new Map<string, string>();
const socketToNickname = new Map<string, string>();

const createLobbySchema = z.object({
  nickname: z.string().min(1).max(32),
  openaiApiKey: z.string().min(1).max(200).optional()
});

const joinLobbySchema = z.object({
  code: z.string().min(4).max(10),
  nickname: z.string().min(1).max(32)
});

const generateCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
};

const insertMessage = db.prepare(
  'INSERT INTO messages (lobbyCode, sender, role, content, createdAt) VALUES (?, ?, ?, ?, ?)' as const
);

const selectMessages = db.prepare(
  'SELECT id, lobbyCode, sender, role, content, createdAt FROM messages WHERE lobbyCode = ? ORDER BY createdAt ASC'
);

app.post('/lobby', (req, res) => {
  const parsed = createLobbySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  const code = generateCode();
  lobbies.set(code, {
    code,
    openaiKey: parsed.data.openaiApiKey || process.env.OPENAI_API_KEY
  });
  lobbyUsers.set(code, new Map());

  return res.json({ code });
});

app.post('/lobby/join', (req, res) => {
  const parsed = joinLobbySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }

  if (!lobbies.has(parsed.data.code)) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  return res.json({ ok: true });
});

app.get('/lobby/:code/messages', (req, res) => {
  const { code } = req.params;
  if (!lobbies.has(code)) {
    return res.status(404).json({ error: 'Lobby not found' });
  }
  const rows = selectMessages.all(code);
  return res.json({ messages: rows });
});

const broadcastUsers = (code: string) => {
  const users = Array.from(lobbyUsers.get(code)?.values() || []);
  io.to(code).emit('users', users);
};

const sendAssistantMessage = async (code: string, content: string) => {
  const lobby = lobbies.get(code);
  const apiKey = lobby?.openaiKey;

  if (!apiKey) {
    io.to(code).emit('message', {
      id: Date.now(),
      sender: 'DM',
      role: 'assistant',
      content: 'No OpenAI API key configured for this lobby.',
      createdAt: Date.now()
    });
    return;
  }

  try {
    const client = new OpenAI({ apiKey });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful DM for a multiplayer lobby. Provide short, encouraging replies.'
        },
        { role: 'user', content }
      ]
    });

    const assistantMessage = completion.choices[0]?.message?.content || 'Ready to keep chatting!';
    const createdAt = Date.now();
    insertMessage.run(code, 'DM', 'assistant', assistantMessage, createdAt);
    io.to(code).emit('message', {
      id: createdAt,
      sender: 'DM',
      role: 'assistant',
      content: assistantMessage,
      createdAt
    });
  } catch (error) {
    console.error('OpenAI error', error);
    io.to(code).emit('message', {
      id: Date.now(),
      sender: 'DM',
      role: 'assistant',
      content: 'The DM is unavailable right now.',
      createdAt: Date.now()
    });
  }
};

io.on('connection', (socket) => {
  socket.on('joinLobby', (payload: unknown, callback?: (data: { error?: string }) => void) => {
    const parsed = joinLobbySchema.safeParse(payload);
    if (!parsed.success) {
      callback?.({ error: 'Invalid payload' });
      return;
    }

    const { code, nickname } = parsed.data;
    if (!lobbies.has(code)) {
      callback?.({ error: 'Lobby not found' });
      return;
    }

    socket.join(code);
    socketToLobby.set(socket.id, code);
    socketToNickname.set(socket.id, nickname);
    const users = lobbyUsers.get(code) || new Map<string, string>();
    users.set(socket.id, nickname);
    lobbyUsers.set(code, users);
    broadcastUsers(code);
    callback?.({});
  });

  socket.on('message', async (payload: unknown, callback?: (data: { error?: string }) => void) => {
    const messageSchema = z.object({
      code: z.string(),
      nickname: z.string(),
      content: z.string().min(1).max(400)
    });
    const parsed = messageSchema.safeParse(payload);
    if (!parsed.success) {
      callback?.({ error: 'Invalid payload' });
      return;
    }

    const { code, nickname, content } = parsed.data;
    if (!lobbies.has(code)) {
      callback?.({ error: 'Lobby not found' });
      return;
    }

    const createdAt = Date.now();
    insertMessage.run(code, nickname, 'user', content, createdAt);
    const message = { id: createdAt, sender: nickname, role: 'user', content, createdAt };
    io.to(code).emit('message', message);
    sendAssistantMessage(code, content);
    callback?.({});
  });

  socket.on('disconnect', () => {
    const code = socketToLobby.get(socket.id);
    if (!code) return;

    socketToLobby.delete(socket.id);
    const users = lobbyUsers.get(code);
    if (users) {
      users.delete(socket.id);
      lobbyUsers.set(code, users);
      broadcastUsers(code);
    }
    socketToNickname.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
