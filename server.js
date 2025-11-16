import { WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFileSync } from 'fs';

import app from './modules/app.js';
import websocketInitializer from './routes/websocket.js';

const port = process.env.PORT || 5000;

let server;

// HTTPS if both TLS_KEY and TLS_CERT are provided (optional)
if (process.env.TLS_KEY && process.env.TLS_CERT) {
  const options = {
    key: readFileSync(process.env.TLS_KEY),
    cert: readFileSync(process.env.TLS_CERT),
  };
  server = createHttpsServer(options, app);
} else if (process.env.TLS_KEY || process.env.TLS_CERT) {
  throw new Error('HTTPS requires both TLS_KEY and TLS_CERT');
} else {
  server = createHttpServer(app); // HTTP for Fly
}

// WebSocket server
const wss = new WebSocketServer({
  clientTracking: false,
  noServer: true,
});

websocketInitializer(server, wss);

// Bind to 0.0.0.0 so Fly can reach it
server.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});
