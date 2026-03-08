import express from 'express'
import http from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { registerSocketHandlers } from './socket/handlers'

const app = express()
const server = http.createServer(app)

const io = new SocketIOServer(server, {
    cors: {
        origin: ['http://localhost:5174', 'http://localhost:5173'],
        methods: ['GET', 'POST'],
    },
})

app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
})

io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`)
    registerSocketHandlers(io, socket)
    socket.on('disconnect', () => {
        console.log(`[Socket] Disconnected: ${socket.id}`)
    })
})

const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`)
})
