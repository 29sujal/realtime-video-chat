const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());

// Serve frontend (if using same server)
app.use(express.static(path.join(__dirname, "../public")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// -------------------- SOCKET.IO LOGIC --------------------
io.on("connection", socket => {
  console.log("✅ New socket connected:", socket.id);

  socket.on("join-room", roomId => {
    socket.join(roomId);
    socket.roomId = roomId;
    console.log(`📡 ${socket.id} joined room ${roomId}`);

    // Notify others in the room that someone joined
    socket.to(roomId).emit("user-joined", socket.id);
  });

  // Relay WebRTC signaling data
  socket.on("signal", data => {
    io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
  });

  // Handle disconnection cleanly
  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
    if (socket.roomId) {
      socket.to(socket.roomId).emit("user-left", socket.id);
    }
  });
});

// -------------------- START SERVER --------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`🚀 Global Video Chat Server running on http://localhost:${PORT}`)
);
