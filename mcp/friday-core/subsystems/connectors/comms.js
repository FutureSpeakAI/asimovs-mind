/**
 * Communications Hub Connector -- Webhooks, email, HTTP, and notifications
 *
 * Ported from nexus-os: connectors/comms-hub.ts (1,052 lines)
 * Stripped of: Electron, requireConsent gate (handled by execution delegate).
 * Kept: Slack, Discord, Teams webhooks, SMTP email, HTTP request, toast notifications.
 * Uses only Node.js built-in modules (https, http, net, tls).
 */

import * as https from 'node:https';
import * as http from 'node:http';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { execFile } from 'node:child_process';

const MAX_RESPONSE_BYTES = 32 * 1024;
const HTTP_TIMEOUT_MS = 15_000;
const SMTP_TIMEOUT_MS = 30_000;
const PS_TIMEOUT_MS = 15_000;

// -- Safety helpers --

function validateWebhookUrl(raw, allowHttp = false) {
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error(`Invalid URL: ${raw}`); }
  if (allowHttp) {
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('URL must use HTTP or HTTPS.');
  } else {
    if (parsed.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS.');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1', '0.0.0.0'].includes(hostname) || hostname.endsWith('.local')) {
    throw new Error('URL must not target localhost.');
  }
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = ipv4Match.slice(1).map(Number);
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      throw new Error('URL must not target private IP ranges.');
    }
  }
  // Block IPv6 private/link-local ranges (fc00::/7, fe80::/10)
  if (hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80')) {
    throw new Error('URL must not target IPv6 private/link-local ranges.');
  }
}

// Sanitize SMTP header fields — strip CR/LF to prevent header injection
function smtpSafe(s) { return String(s).replace(/[\r\n]/g, ''); }
function _psEscape(s) { return s.replace(/'/g, "''"); }
function xmlEsc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// -- HTTP helper --

function httpRequest(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const reqOptions = {
      hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search, method: options.method ?? 'POST',
      headers: { ...(options.headers ?? {}) },
    };
    if (options.body != null) {
      const buf = typeof options.body === 'string' ? Buffer.from(options.body, 'utf-8') : options.body;
      reqOptions.headers['Content-Length'] = String(buf.length);
    }
    const timeout = options.timeoutMs ?? HTTP_TIMEOUT_MS;
    const req = transport.request(reqOptions, (res) => {
      const chunks = [];
      let totalBytes = 0;
      res.on('data', (chunk) => { totalBytes += chunk.length; if (totalBytes <= MAX_RESPONSE_BYTES) chunks.push(chunk); });
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf-8');
        resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: totalBytes > MAX_RESPONSE_BYTES ? bodyStr + '\n[...truncated at 32 KB]' : bodyStr });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error(`HTTP request timed out (${timeout / 1000}s)`)); });
    if (options.body != null) req.write(options.body);
    req.end();
  });
}

// -- SMTP client --

function smtpSendEmail(params) {
  const { host, port, user, pass, from, to, subject, body: mailBody, html } = params;
  return new Promise((resolve, reject) => {
    let socket = net.createConnection({ host, port });
    let buffer = '', step = 0, upgraded = false;
    const CRLF = '\r\n';
    const send = (line) => socket.write(line + CRLF);
    const buildMessage = () => {
      const ct = html ? 'Content-Type: text/html; charset=UTF-8' : 'Content-Type: text/plain; charset=UTF-8';
      return [`From: ${smtpSafe(from)}`, `To: ${smtpSafe(to)}`, `Subject: ${smtpSafe(subject)}`, 'MIME-Version: 1.0', ct, '', mailBody].join(CRLF);
    };
    const advance = (code, text) => {
      try {
        switch (step) {
          case 0: if (code !== 220) throw new Error(`SMTP greeting failed: ${code}`); step = 1; send('EHLO agent-friday'); break;
          case 1: if (code !== 250) throw new Error(`EHLO failed: ${code}`);
            if (!upgraded && text.toUpperCase().includes('STARTTLS')) { step = 2; send('STARTTLS'); }
            else { step = 3; send('AUTH LOGIN'); } break;
          case 2: if (code !== 220) throw new Error(`STARTTLS failed: ${code}`);
            { const tlsSocket = tls.connect({ socket, host, servername: host }, () => { upgraded = true; socket = tlsSocket; buffer = ''; socket.on('data', onData); step = 1; send('EHLO agent-friday'); }); tlsSocket.on('error', reject); } break;
          case 3: if (code !== 334) throw new Error(`AUTH LOGIN failed: ${code}`); step = 4; send(Buffer.from(user).toString('base64')); break;
          case 4: if (code !== 334) throw new Error(`AUTH user failed: ${code}`); step = 5; send(Buffer.from(pass).toString('base64')); break;
          case 5: if (code !== 235) throw new Error(`AUTH password failed: ${code}`); step = 6; send(`MAIL FROM:<${smtpSafe(from)}>`); break;
          case 6: if (code !== 250) throw new Error(`MAIL FROM failed: ${code}`); step = 7; send(`RCPT TO:<${smtpSafe(to)}>`); break;
          case 7: if (code !== 250) throw new Error(`RCPT TO failed: ${code}`); step = 8; send('DATA'); break;
          case 8: if (code !== 354) throw new Error(`DATA failed: ${code}`); step = 9;
            { const msg = buildMessage().replace(/\r\n\./g, '\r\n..'); socket.write(msg + CRLF + '.' + CRLF); } break;
          case 9: if (code !== 250) throw new Error(`Send failed: ${code}`); step = 10; send('QUIT'); break;
          case 10: socket.end(); resolve(`Email sent to ${to}`); break;
        }
      } catch (err) { socket.destroy(); reject(err); }
    };
    const onData = (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split(CRLF);
      buffer = lines.pop() ?? '';
      let lastCode = 0, fullText = '';
      for (const line of lines) { if (line.length < 3) continue; const code = parseInt(line.substring(0, 3), 10); fullText += line + '\n'; if (line[3] === ' ' || line[3] === undefined) lastCode = code; }
      if (lastCode > 0) advance(lastCode, fullText.trim());
    };
    socket.on('data', onData);
    socket.on('error', reject);
    socket.setTimeout(SMTP_TIMEOUT_MS, () => { socket.destroy(new Error('SMTP timeout')); });
  });
}

// -- PowerShell runner for toasts --

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: PS_TIMEOUT_MS }, (err, stdout, stderr) => {
        if (err) return reject(new Error(`PowerShell: ${err.message}${stderr ? ' -- ' + stderr : ''}`));
        resolve((stdout ?? '').trim());
      });
  });
}

// -- Tool Implementations --

async function slackSendWebhook(args) {
  validateWebhookUrl(args.url);
  const payload = { text: args.text };
  if (args.blocks) { try { payload.blocks = JSON.parse(args.blocks); } catch (e) { throw new Error(`Invalid blocks JSON: ${e.message}`); } }
  const res = await httpRequest(args.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`Slack returned HTTP ${res.statusCode}: ${res.body}`);
  return `Slack message sent (HTTP ${res.statusCode})`;
}

async function discordSendWebhook(args) {
  validateWebhookUrl(args.url);
  const payload = { content: args.content };
  if (args.embeds) { try { const p = JSON.parse(args.embeds); payload.embeds = Array.isArray(p) ? p : [p]; } catch (e) { throw new Error(`Invalid embeds JSON: ${e.message}`); } }
  const res = await httpRequest(args.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`Discord returned HTTP ${res.statusCode}`);
  return `Discord message sent (HTTP ${res.statusCode})`;
}

async function teamsSendWebhook(args) {
  validateWebhookUrl(args.url);
  let payload;
  if (args.card) { try { payload = JSON.parse(args.card); } catch (e) { throw new Error(`Invalid card JSON: ${e.message}`); } }
  else { payload = { '@type': 'MessageCard', '@context': 'http://schema.org/extensions', summary: args.text.slice(0, 80), text: args.text }; }
  const res = await httpRequest(args.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`Teams returned HTTP ${res.statusCode}`);
  return `Teams message sent (HTTP ${res.statusCode})`;
}

async function smtpSendEmailTool(args) {
  const { host, user, pass, from, to, subject, body } = args;
  if (!host || !user || !pass || !from || !to || !subject || !body) throw new Error('host, user, pass, from, to, subject, body all required.');
  return smtpSendEmail({ host, port: Number(args.port ?? 587), user, pass, from, to, subject, body, html: Boolean(args.html) });
}

async function httpRequestTool(args) {
  if (!args.url) throw new Error('url is required.');
  validateWebhookUrl(args.url, true);
  const method = String(args.method ?? 'POST').toUpperCase();
  const allowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
  if (!allowed.includes(method)) throw new Error(`Unsupported method: ${method}`);
  const headers = {};
  if (args.headers && typeof args.headers === 'object') {
    for (const [k, v] of Object.entries(args.headers)) {
      if (!/^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/.test(k)) throw new Error(`Invalid header name: ${k}`);
      headers[k] = String(v);
    }
  }
  const res = await httpRequest(args.url, { method, headers, body: args.body != null ? String(args.body) : undefined });
  return `HTTP ${method} ${args.url} -> ${res.statusCode}\n\n${res.body}`;
}

async function webhookSend(args) {
  if (!args.url) throw new Error('url is required.');
  validateWebhookUrl(args.url);
  const method = String(args.method ?? 'POST').toUpperCase();
  const headers = {};
  if (args.headers && typeof args.headers === 'object') {
    for (const [k, v] of Object.entries(args.headers)) {
      if (!/^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/.test(k)) throw new Error(`Invalid header name: ${k}`);
      headers[k] = String(v);
    }
  }
  if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
  const res = await httpRequest(args.url, { method, headers, body: args.body != null ? String(args.body) : undefined });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`Webhook returned HTTP ${res.statusCode}`);
  return `Webhook ${method} -> ${res.statusCode}`;
}

async function notificationToast(args) {
  if (!args.title || !args.body) throw new Error('title and body are required.');
  const tXml = xmlEsc(args.title), bXml = xmlEsc(args.body);
  try {
    const script = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$toastXml = @"
<toast><visual><binding template="ToastGeneric"><text>${tXml}</text><text>${bXml}</text></binding></visual></toast>
"@
$xml.LoadXml($toastXml)
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
Write-Output 'Toast shown.'`.trim();
    return await runPowerShell(script) || 'Toast displayed.';
  } catch {
    // Sanitize for single-quoted PowerShell: strip all chars that could break out
    const safePsStr = (s) => String(s).replace(/[';$()[\]{}|`\\]/g, '');
    const fallback = `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.BalloonTipTitle='${safePsStr(args.title)}'; $n.BalloonTipText='${safePsStr(args.body)}'; $n.Visible=$true; $n.ShowBalloonTip(5000); Start-Sleep -Milliseconds 5500; $n.Dispose(); Write-Output 'Balloon shown.'`;
    return await runPowerShell(fallback) || 'Balloon notification displayed.';
  }
}

// -- Exports --

export function getTools() {
  return [
    { name: 'slack_send_webhook', description: 'Send a message to Slack via webhook', params: { url: 'string', text: 'string', blocks: 'string (JSON)' }, safety_level: 'write', category: 'communication' },
    { name: 'discord_send_webhook', description: 'Send a message to Discord via webhook', params: { url: 'string', content: 'string', embeds: 'string (JSON)' }, safety_level: 'write', category: 'communication' },
    { name: 'teams_send_webhook', description: 'Send a message to Teams via webhook', params: { url: 'string', text: 'string', card: 'string (JSON)' }, safety_level: 'write', category: 'communication' },
    { name: 'smtp_send_email', description: 'Send email via SMTP with STARTTLS + AUTH LOGIN', params: { host: 'string', port: 'number', user: 'string', pass: 'string', from: 'string', to: 'string', subject: 'string', body: 'string', html: 'boolean' }, safety_level: 'write', category: 'communication' },
    { name: 'http_request', description: 'Make an HTTP/HTTPS request to any URL', params: { url: 'string', method: 'string', headers: 'object', body: 'string' }, safety_level: 'write', category: 'communication' },
    { name: 'webhook_send', description: 'Send a payload to any webhook endpoint (HTTPS only)', params: { url: 'string', method: 'string', headers: 'object', body: 'string' }, safety_level: 'write', category: 'communication' },
    { name: 'notification_toast', description: 'Show a Windows toast notification', params: { title: 'string', body: 'string' }, safety_level: 'write', category: 'communication' },
  ];
}

export async function execute(toolName, args) {
  try {
    let result;
    switch (toolName) {
      case 'slack_send_webhook':   result = await slackSendWebhook(args); break;
      case 'discord_send_webhook': result = await discordSendWebhook(args); break;
      case 'teams_send_webhook':   result = await teamsSendWebhook(args); break;
      case 'smtp_send_email':      result = await smtpSendEmailTool(args); break;
      case 'http_request':         result = await httpRequestTool(args); break;
      case 'webhook_send':         result = await webhookSend(args); break;
      case 'notification_toast':   result = await notificationToast(args); break;
      default: return { error: `Unknown comms-hub tool: ${toolName}` };
    }
    return { result };
  } catch (err) { return { error: `comms-hub "${toolName}" failed: ${err.message}` }; }
}

export async function detect() {
  // Web-based APIs work on any system with network access
  return true;
}

export const name = 'comms-hub';
export const description = 'Slack, Discord, Teams webhooks; SMTP email; HTTP requests; Windows toast notifications';
