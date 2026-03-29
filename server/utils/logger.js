/**
 * Structured Logger for Agentic EHR
 *
 * Lightweight structured logging that outputs JSON in production
 * and human-readable format in development. No external dependencies.
 *
 * Usage:
 *   const logger = require('./utils/logger');
 *   logger.info('Server started', { port: 3000 });
 *   logger.error('DB failed', { error: err.message });
 *   logger.child({ module: 'auth' }).info('Login success');
 */

const LOG_LEVELS = { fatal: 60, error: 50, warn: 40, info: 30, debug: 20, trace: 10 };
const LEVEL_NAMES = Object.fromEntries(Object.entries(LOG_LEVELS).map(([k, v]) => [v, k.toUpperCase()]));

const configuredLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || LOG_LEVELS.info;
const isProduction = process.env.NODE_ENV === 'production';

function formatDev(level, msg, meta) {
  const ts = new Date().toISOString().slice(11, 23);
  const lvl = LEVEL_NAMES[level].padEnd(5);
  const prefix = meta._module ? `[${meta._module}]` : '';
  const extras = Object.keys(meta).filter(k => k !== '_module');
  const extraStr = extras.length > 0
    ? ' ' + extras.map(k => `${k}=${JSON.stringify(meta[k])}`).join(' ')
    : '';
  return `${ts} ${lvl} ${prefix} ${msg}${extraStr}`;
}

function formatJson(level, msg, meta) {
  return JSON.stringify({
    level: LEVEL_NAMES[level],
    time: new Date().toISOString(),
    msg,
    ...meta,
  });
}

const format = isProduction ? formatJson : formatDev;

function makeLogger(baseMeta = {}) {
  const logger = {};

  for (const [name, level] of Object.entries(LOG_LEVELS)) {
    logger[name] = (msg, meta = {}) => {
      if (level < configuredLevel) return;
      const merged = { ...baseMeta, ...meta };
      const line = format(level, msg, merged);
      if (level >= LOG_LEVELS.error) {
        process.stderr.write(line + '\n');
      } else {
        process.stdout.write(line + '\n');
      }
    };
  }

  logger.child = (childMeta) => makeLogger({ ...baseMeta, ...childMeta });

  return logger;
}

module.exports = makeLogger();
