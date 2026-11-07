/* Enkel strukturert logging. JSON i produksjon, lesbar tekst lokalt. */
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const minLevel: Level =
  (process.env.LOG_LEVEL as Level | undefined) ?? (process.env.NODE_ENV === 'test' ? 'warn' : 'info');
const json = process.env.NODE_ENV === 'production';

const SECRET_KEYS = /(password|secret|token|authorization|api[_-]?key|cookie)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.test(k) ? '[skjult]' : redact(v, depth + 1);
  }
  return out;
}

function write(level: Level, msg: string, data?: Record<string, unknown>) {
  if (order[level] < order[minLevel]) return;
  const payload = data ? (redact(data) as Record<string, unknown>) : undefined;
  if (json) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...payload });
    (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
  } else {
    const extra = payload && Object.keys(payload).length ? ' ' + JSON.stringify(payload) : '';
    const line = `${new Date().toISOString().slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg}${extra}`;
    (level === 'error' ? console.error : console.log)(line);
  }
}

type ErrorHook = (msg: string, data: Record<string, unknown> | undefined) => void;
const errorHooks: ErrorHook[] = [];

/** Kalles for hver feil som logges med log.error (brukes av feilovervåkingen). Gir tilbake en funksjon som fjerner kroken. */
export function onErrorLogged(hook: ErrorHook): () => void {
  errorHooks.push(hook);
  return () => {
    const i = errorHooks.indexOf(hook);
    if (i >= 0) errorHooks.splice(i, 1);
  };
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => write('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => {
    write('error', msg, data);
    for (const hook of errorHooks) {
      try {
        hook(msg, data);
      } catch {
        // Overvåkingen skal aldri velte det som logget feilen.
      }
    }
  },
};
