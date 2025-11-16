import { WebSocketServer } from 'ws';
import { Server } from 'http';
import { createServer } from 'https';
import { readFileSync } from 'fs';

import app from './modules/app.js';

const port = process.env.PORT || 5000;
let server;

if (process.env.TLS_KEY && process.env.TLS_CERT) {
	const options = {
		key: readFileSync(process.env.TLS_KEY),
		cert: readFileSync(process.env.TLS_CERT),
	};
	server = createServer(options, app);
} else if (process.env.TLS_KEY || process.env.TLS_CERT) {
	throw new Error('HTTPS requires both TLS_KEY and TLS_CERT');
} else {
	server = Server(app);
}

// WebSocket setup
const wss = new WebSocketServer({
	clientTracking: false,
	noServer: true,
});

import websocketInitializer from './routes/websocket.js';
websocketInitializer(server, wss);

server.listen(port, '0.0.0.0', () => {
	console.log(`Server listening on port ${port}`);
});
