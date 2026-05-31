import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { authMiddleware } from './middleware/auth.mjs';
import { skillsRoutes } from './routes/skills.mjs';
import { pluginsRoutes } from './routes/plugins.mjs';
import { usersRoutes } from './routes/users.mjs';
import { auditRoutes } from './routes/audit.mjs';
import { adminRoutes } from './routes/admin.mjs';

export const app = new Hono();

app.use('*', authMiddleware);

skillsRoutes(app);
pluginsRoutes(app);
usersRoutes(app);
auditRoutes(app);
adminRoutes(app);

export const handler = handle(app);
