# Lobby

Minimal lobby MVP with Expo React Native frontend and Node.js + Socket.IO backend.

## Features
- Create or join lobbies with a nickname and server URL.
- Live users list and message stream powered by Socket.IO.
- Messages stored in SQLite (better-sqlite3).
- Backend optionally calls the OpenAI API to reply as a DM after each user message.
- OpenAI API key can come from backend `.env` or (optionally) be provided when creating a lobby; the latter is held in memory only.

## Prerequisites
- Node.js 18+ and npm
- Expo tooling (`npx expo-cli` will install automatically on first run)

## Backend setup
```bash
cd backend
cp .env.example .env
# Edit .env to add OPENAI_API_KEY (optional if you plan to pass the key from the app when creating a lobby)

npm install
npm run dev
```
The server listens on `PORT` (default `3001`).

## Mobile app setup
```bash
cd mobile
npm install
npx expo start --tunnel
```
Then scan the QR code in the terminal/Expo DevTools to open the app on a device or emulator.

## Usage flow
1. On the Home screen, enter a nickname, lobby code (for joining), server URL, and optionally an OpenAI API key **only when creating** a lobby.
2. Tap **Create** to generate a lobby code or **Join** to enter an existing lobby.
3. On the Lobby screen, chat with others; the backend will save messages and respond with DM replies when an API key is available.

## API endpoints (backend)
- `POST /lobby` – body: `{ nickname, openaiApiKey? }`; returns `{ code }`.
- `POST /lobby/join` – body: `{ code, nickname }`; returns `{ ok: true }`.
- `GET /lobby/:code/messages` – returns `{ messages: [...] }` for an existing lobby.

## Notes
- The OpenAI API key is never stored in the mobile app. If you provide it during lobby creation, it is kept in backend memory for that lobby only.
- SQLite database is written to `backend/data/lobby.db`.
