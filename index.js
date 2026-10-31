import { apply as metrics } from './plugins/server-metrics/index.js';
import { apply as billing } from './plugins/session-billing/index.js';

export const name = 'dsh-toolkit';
export const inject = ['webServer', 'sessionProjections', 'connection'];

export async function apply(ctx) {
  metrics(ctx);
  await billing(ctx);
}
