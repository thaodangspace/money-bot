import { type RuntimeEnvironment, shouldRunFullApplication } from './main.ts';
function environment(values: Record<string, string>): RuntimeEnvironment {
  return { get: (name) => values[name] };
}
Deno.test('local and production timelines run the webhook application', () => {
  if (!shouldRunFullApplication(environment({}))) throw new Error('local runtime disabled');
  if (
    !shouldRunFullApplication(environment({ DENO_DEPLOY: 'true', DENO_TIMELINE: 'production' }))
  ) throw new Error('production runtime disabled');
});
Deno.test('Deno Deploy non-production timelines are health-only', () => {
  for (const timeline of ['preview', 'git']) {
    if (shouldRunFullApplication(environment({ DENO_DEPLOY: 'true', DENO_TIMELINE: timeline }))) {
      throw new Error('non-production runtime enabled');
    }
  }
});
