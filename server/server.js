const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "../public")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

io.on("connection", socket => {
  console.log("socket connected", socket.id);

  socket.on("join-room", roomId => {
    socket.join(roomId);
    socket.to(roomId).emit("user-joined", socket.id);
  });

  socket.on("signal", data => {
    io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
  });

  socket.on("disconnect", () => {
    console.log("socket disconnected", socket.id);
    io.emit("user-left", socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));
