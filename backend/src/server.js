require('dotenv').config();

const { Pool } = require('pg');
const { createApp } = require('./app');

const pool = new Pool();
const port = Number(process.env.PORT || 3000);
const app = createApp(pool);

const server = app.listen(port, () => {
  console.log(`Solar panel API listening on port ${port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down`);
  server.close(async (serverError) => {
    if (serverError) {
      console.error('HTTP server shutdown failed:', serverError);
      process.exitCode = 1;
    }

    try {
      await pool.end();
    } catch (poolError) {
      console.error('Database pool shutdown failed:', poolError);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
