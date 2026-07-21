import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { attempt } from './routes/attempt';
import { build } from './routes/build';
import { placement } from './routes/placement';
import { score } from './routes/score';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { scheduler } from './routes/scheduler';
import { triggers } from './routes/triggers';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);
internal.route('/scheduler', scheduler);

app.route('/api', api);
app.route('/api/attempt', attempt);
app.route('/api/placement', placement);
app.route('/api/score', score);
app.route('/api/build', build);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
