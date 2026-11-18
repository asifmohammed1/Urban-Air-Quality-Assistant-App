import express from 'express';
import { createApiRouter } from '../src/server/routes.ts';

const app = express();

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self)');
  next();
});

app.use(express.json({ limit: '256kb' }));

const apiRouter = createApiRouter();
app.use('/api', apiRouter);
app.use('/', apiRouter);

export default app;
