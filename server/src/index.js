// Entry point: starts the HTTP server.
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 4000;

createApp().listen(port, () => {
  console.log(`FeeSaathi API listening at http://localhost:${port}`);
});
