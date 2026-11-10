import { apply as metrics } from './plugins/server-metrics/index.js';
import { apply as common } from './vendor/dsh-toolkit-local/index.js';

export const name = 'dsh-toolkit';
export const inject = ['webServer', 'sessionProjections', 'connection'];

export async function apply(ctx) {
  metrics(ctx);
  await common(ctx);
}
