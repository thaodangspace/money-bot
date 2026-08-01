import { type RuntimeEnvironment, shouldRunPolling } from './main.ts';

function environment(values: Record<string, string>): RuntimeEnvironment {
  return { get: (name) => values[name] };
}

Deno.test('local runtime uses Telegram polling', () => {
  if (!shouldRunPolling(environment({}))) throw new Error('polling was disabled locally');
});

Deno.test('Deno Deploy production uses Telegram polling', () => {
  if (!shouldRunPolling(environment({ DENO_DEPLOY: 'true', DENO_TIMELINE: 'production' }))) {
    throw new Error('polling was disabled in production');
  }
});

Deno.test('Deno Deploy preview and branch timelines do not poll Telegram', () => {
  for (const timeline of ['preview/revision-id', 'git-branch/main', '']) {
    if (shouldRunPolling(environment({ DENO_DEPLOY: 'true', DENO_TIMELINE: timeline }))) {
      throw new Error(`polling was enabled for ${timeline || 'an unknown timeline'}`);
    }
  }
});
