/**
 * Structured stderr logger for Friday Core
 * MCP uses stdout for protocol, so all logs go to stderr.
 */

export class Logger {
  #prefix;

  constructor(prefix = 'friday') {
    this.#prefix = prefix;
  }

  child(subsystem) {
    return new Logger(`${this.#prefix}:${subsystem}`);
  }

  info(msg, data) {
    this.#write('INFO', msg, data);
  }

  warn(msg, data) {
    this.#write('WARN', msg, data);
  }

  error(msg, data) {
    this.#write('ERROR', msg, data);
  }

  #write(level, msg, data) {
    const line = data
      ? `[${this.#prefix}] ${level}: ${msg} ${JSON.stringify(data)}`
      : `[${this.#prefix}] ${level}: ${msg}`;
    process.stderr.write(line + '\n');
  }
}
