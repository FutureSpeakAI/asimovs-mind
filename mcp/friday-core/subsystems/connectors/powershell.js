/**
 * PowerShell Connector -- Deep Windows system control
 *
 * Ported from nexus-os: connectors/powershell.ts (842 lines)
 * Provides: arbitrary script execution, COM automation, registry access,
 * WMI queries, service control, installed apps, system info, env vars, clipboard.
 *
 * Safety: dangerous patterns blocked, critical registry paths protected.
 * All commands run with -NoProfile -NonInteractive -ExecutionPolicy Bypass.
 */

import { execFileSync, spawn } from 'node:child_process';

const PS_BASE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 64 * 1024;

// -- Safety --

const DANGEROUS_COMMAND_PATTERNS = [
  /\bFormat-Volume\b/i, /\bClear-Disk\b/i, /\bInitialize-Disk\b/i, /\bRemove-Partition\b/i,
  /Remove-Item\s+.*(?:C:\\Windows|C:\\Program\s*Files|System32|SysWOW64).*-Recurse/i,
  /\bStop-Computer\b/i, /\bRestart-Computer\b/i, /\bshutdown\s+\//i,
  /\bMimikatz\b/i, /\bInvoke-Mimikatz\b/i,
  /\bSet-MpPreference\b.*\bDisableRealtimeMonitoring\b/i,
  /\bbcdedit\b.*\/delete/i,
  /\bInvoke-Expression\b/i, /\biex[\s(]/i,
  /\[scriptblock\]::(?:create|new)/i,
  /\bNew-PSSession\b/i, /\bEnter-PSSession\b/i,
  /\bAdd-MpPreference\b.*\bExclusionPath\b/i, /\bAdd-MpExclusion\b/i,
  /\bcertutil\b/i,
  /\bStart-Process\b/i,
  /\bSet-ExecutionPolicy\b/i,
  /\bInvoke-WebRequest\b/i, /\bInvoke-RestMethod\b/i,
  /\bWebClient\b/i, /\bDownloadString\b/i, /\bDownloadFile\b/i,
  /\bInvoke-History\b/i,
];

const BLOCKED_REGISTRY_WRITE_PREFIXES = [
  'HKLM:\\SYSTEM', 'HKLM:\\SECURITY', 'HKLM:\\SAM',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
];

const BLOCKED_REGISTRY_READ_PREFIXES = ['HKLM:\\SAM', 'HKLM:\\SECURITY'];

function checkDangerousCommand(command) {
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(command)) return `Blocked: matches dangerous pattern ${pattern.source}`;
  }
  return null;
}

function normaliseRegistryPath(p) {
  return p.replace(/\//g, '\\').replace(/:\\\\?/g, ':\\').replace(/\\+$/g, '');
}

function isRegistryWriteBlocked(regPath) {
  const norm = normaliseRegistryPath(regPath).toUpperCase();
  return BLOCKED_REGISTRY_WRITE_PREFIXES.some(p => norm.startsWith(normaliseRegistryPath(p).toUpperCase()));
}

function isRegistryReadBlocked(regPath) {
  const norm = normaliseRegistryPath(regPath).toUpperCase();
  return BLOCKED_REGISTRY_READ_PREFIXES.some(p => norm.startsWith(normaliseRegistryPath(p).toUpperCase()));
}

// -- PowerShell runner --

function runPowerShell(command, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [...PS_BASE_ARGS, command], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', killed = false, settled = false;
    function settle(fn, val) { if (settled) return; settled = true; fn(val); }
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); settle(reject, new Error(`PowerShell timed out after ${timeoutMs / 1000}s`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); if (stdout.length > MAX_OUTPUT_LENGTH) stdout = stdout.slice(0, MAX_OUTPUT_LENGTH); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > MAX_OUTPUT_LENGTH) stderr = stderr.slice(0, MAX_OUTPUT_LENGTH); });
    child.on('error', (err) => { clearTimeout(timer); settle(reject, err); });
    child.on('close', (code) => { clearTimeout(timer); if (killed) return; if (code !== 0 && stderr.trim()) settle(reject, new Error(stderr.trim())); else settle(resolve, stdout.trim()); });
  });
}

async function safeRun(command, timeoutMs) {
  try { return { result: await runPowerShell(command, timeoutMs) || '(no output)' }; }
  catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
}

function psEsc(value) { return value.replace(/'/g, "''"); }

const COM_METHOD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// -- Tool Implementations --

async function executeCommand(args) {
  const command = String(args.command ?? '');
  if (!command.trim()) return { error: 'No command provided.' };
  const blocked = checkDangerousCommand(command);
  if (blocked) return { error: blocked };
  const timeoutSec = Number(args.timeout_seconds) || 30;
  return safeRun(command, Math.min(Math.max(timeoutSec, 1), 300) * 1000);
}

async function comInvoke(args) {
  const progId = String(args.progId ?? ''), method = String(args.method ?? '');
  if (!progId || !method) return { error: 'progId and method required.' };
  if (!COM_METHOD_PATTERN.test(method)) return { error: 'method must be a valid identifier.' };
  const comArgs = Array.isArray(args.args) ? args.args : [];
  const argList = comArgs.map(a => `'${psEsc(String(a))}'`).join(', ');
  const script = [
    `$obj = New-Object -ComObject '${psEsc(progId)}'`,
    'try {',
    argList ? `  $result = $obj.${method}(${argList})` : `  $result = $obj.${method}()`,
    '  if ($null -ne $result) { $result | Out-String -Width 300 } else { Write-Output "(null)" }',
    '} finally { try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj) | Out-Null } catch {} }',
  ].join('\n');
  return safeRun(script);
}

async function registryRead(args) {
  const regPath = String(args.path ?? '');
  if (!regPath) return { error: 'Registry path required.' };
  if (isRegistryReadBlocked(regPath)) return { error: `Blocked: reading ${regPath} not permitted.` };
  const valueName = args.name != null ? String(args.name) : null;
  const script = valueName
    ? `Get-ItemProperty -Path '${psEsc(regPath)}' -Name '${psEsc(valueName)}' | Select-Object -ExpandProperty '${psEsc(valueName)}'`
    : `Get-ItemProperty -Path '${psEsc(regPath)}' | Format-List | Out-String -Width 300`;
  return safeRun(script);
}

async function registryWrite(args) {
  const regPath = String(args.path ?? ''), name = String(args.name ?? ''), value = String(args.value ?? '');
  if (!regPath || !name) return { error: 'Registry path and name required.' };
  if (isRegistryWriteBlocked(regPath)) return { error: `Blocked: writing to ${regPath} not permitted.` };
  const typeMap = { string: 'String', dword: 'DWord', qword: 'QWord', binary: 'Binary', expandstring: 'ExpandString', multistring: 'MultiString' };
  const rawType = String(args.type ?? 'String').toLowerCase().replace(/[\s_-]/g, '');
  const psType = typeMap[rawType] || 'String';
  const script = [
    `if (-not (Test-Path '${psEsc(regPath)}')) { New-Item -Path '${psEsc(regPath)}' -Force | Out-Null }`,
    `Set-ItemProperty -Path '${psEsc(regPath)}' -Name '${psEsc(name)}' -Value '${psEsc(value)}' -Type ${psType}`,
    `Write-Output "Wrote ${psType} '${psEsc(name)}' to ${regPath}"`,
  ].join('\n');
  return safeRun(script);
}

const WMI_NAMESPACE_PATTERN = /^[a-zA-Z0-9_/\\]+$/;

// WMI classes that expose sensitive credential or security data
const BLOCKED_WMI_CLASSES = new Set([
  'win32_networkloginprofile', 'win32_useraccount', 'win32_logonsession',
  'win32_loggedonuser', 'win32_ntlogevent', 'win32_shadowcopy',
  'msft_mpsignaturedynamics', 'win32_scheduledjob',
]);

async function wmiQuery(args) {
  const query = String(args.query ?? '');
  if (!query) return { error: 'WMI query required.' };
  const namespace = String(args.namespace ?? 'root/cimv2');
  if (!WMI_NAMESPACE_PATTERN.test(namespace)) return { error: 'Invalid WMI namespace: only alphanumeric, underscore, forward slash, and backslash are allowed.' };
  // Check for blocked WMI classes in the query
  const classMatch = query.match(/\bFROM\s+(\w+)/i);
  if (classMatch && BLOCKED_WMI_CLASSES.has(classMatch[1].toLowerCase())) {
    return { error: `SAFETY BLOCK: WMI class "${classMatch[1]}" is restricted due to credential/security sensitivity.` };
  }
  return safeRun(`Get-CimInstance -Query '${psEsc(query)}' -Namespace '${psEsc(namespace)}' | Format-List | Out-String -Width 300`);
}

async function serviceControl(args) {
  const name = String(args.name ?? ''), action = String(args.action ?? '').toLowerCase();
  if (!name) return { error: 'Service name required.' };
  const valid = ['status', 'start', 'stop', 'restart'];
  if (!valid.includes(action)) return { error: `Invalid action. Must be: ${valid.join(', ')}` };
  const safe = psEsc(name);
  let script;
  switch (action) {
    case 'status': script = `Get-Service -Name '${safe}' | Format-List Name, DisplayName, Status, StartType | Out-String -Width 300`; break;
    case 'start': script = `Start-Service -Name '${safe}'; Get-Service -Name '${safe}' | Select-Object -ExpandProperty Status`; break;
    case 'stop': script = `Stop-Service -Name '${safe}' -Force; Get-Service -Name '${safe}' | Select-Object -ExpandProperty Status`; break;
    case 'restart': script = `Restart-Service -Name '${safe}' -Force; Get-Service -Name '${safe}' | Select-Object -ExpandProperty Status`; break;
  }
  return safeRun(script);
}

async function installedApps() {
  return safeRun(`
$paths = @('HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')
$paths | ForEach-Object { Get-ItemProperty $_ -ErrorAction SilentlyContinue } | Where-Object { $_.DisplayName } | Select-Object DisplayName, DisplayVersion, Publisher, InstallDate | Sort-Object DisplayName -Unique | Format-Table -AutoSize | Out-String -Width 300
`.trim());
}

async function systemInfo() {
  return safeRun(`
$os = Get-CimInstance Win32_OperatingSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
Write-Output "OS: $($os.Caption) $($os.Version) ($($os.OSArchitecture))"
Write-Output "CPU: $($cpu.Name) ($($cpu.NumberOfCores) cores, $($cpu.NumberOfLogicalProcessors) threads)"
Write-Output "RAM: $([math]::Round($os.TotalVisibleMemorySize / 1MB, 2)) GB total, $([math]::Round($os.FreePhysicalMemory / 1MB, 2)) GB free"
$up = (Get-Date) - $os.LastBootUpTime; Write-Output "Uptime: $($up.Days)d $($up.Hours)h $($up.Minutes)m"
`.trim());
}

async function envVariable(args) {
  const name = String(args.name ?? '');
  if (!name) return { error: 'Variable name required.' };
  const scope = String(args.scope ?? 'Process');
  const valid = ['Process', 'User', 'Machine'];
  if (!valid.includes(scope)) return { error: `Invalid scope. Must be: ${valid.join(', ')}` };
  const safe = psEsc(name);
  if (args.value != null) {
    return safeRun(`[Environment]::SetEnvironmentVariable('${safe}', '${psEsc(String(args.value))}', '${scope}'); Write-Output "Set ${scope} variable '${safe}'"`);
  }
  return safeRun(`$v = [Environment]::GetEnvironmentVariable('${safe}', '${scope}'); if ($null -ne $v) { Write-Output $v } else { Write-Output "(not set)" }`);
}

async function clipboardAction(args) {
  const action = String(args.action ?? '').toLowerCase();
  if (action === 'get') return safeRun('Get-Clipboard -Raw');
  if (action === 'set') {
    if (!args.text) return { error: 'Text required for set.' };
    return safeRun(`Set-Clipboard -Value '${psEsc(String(args.text))}'; Write-Output 'Clipboard updated.'`);
  }
  return { error: 'action must be "get" or "set".' };
}

// -- Exports --

export function getTools() {
  return [
    { name: 'powershell_execute', description: 'Execute a PowerShell command (dangerous ops blocked)', params: { command: 'string', timeout_seconds: 'number' }, safety_level: 'write', category: 'system' },
    { name: 'powershell_com_invoke', description: 'Create a COM object and invoke a method', params: { progId: 'string', method: 'string', args: 'string[]' }, safety_level: 'write', category: 'system' },
    { name: 'powershell_registry_read', description: 'Read a Windows registry value or key', params: { path: 'string', name: 'string' }, safety_level: 'read_only', category: 'system' },
    { name: 'powershell_registry_write', description: 'Write a value to the Windows registry (dangerous paths blocked)', params: { path: 'string', name: 'string', value: 'string', type: 'string' }, safety_level: 'write', category: 'system' },
    { name: 'powershell_wmi_query', description: 'Run a WMI/CIM query', params: { query: 'string (WQL)', namespace: 'string' }, safety_level: 'read_only', category: 'system' },
    { name: 'powershell_service_control', description: 'Manage a Windows service (status/start/stop/restart)', params: { name: 'string', action: 'status|start|stop|restart' }, safety_level: 'write', category: 'system' },
    { name: 'powershell_installed_apps', description: 'List all installed applications', params: {}, safety_level: 'read_only', category: 'system' },
    { name: 'powershell_system_info', description: 'Get OS, CPU, RAM, and uptime information', params: {}, safety_level: 'read_only', category: 'system' },
    { name: 'powershell_env_variable', description: 'Get or set an environment variable', params: { name: 'string', value: 'string', scope: 'Process|User|Machine' }, safety_level: 'write', category: 'system' },
    { name: 'powershell_clipboard', description: 'Get or set clipboard text', params: { action: 'get|set', text: 'string' }, safety_level: 'write', category: 'system' },
  ];
}

export async function execute(toolName, args) {
  try {
    switch (toolName) {
      case 'powershell_execute':        return await executeCommand(args);
      case 'powershell_com_invoke':     return await comInvoke(args);
      case 'powershell_registry_read':  return await registryRead(args);
      case 'powershell_registry_write': return await registryWrite(args);
      case 'powershell_wmi_query':      return await wmiQuery(args);
      case 'powershell_service_control':return await serviceControl(args);
      case 'powershell_installed_apps': return await installedApps();
      case 'powershell_system_info':    return await systemInfo();
      case 'powershell_env_variable':   return await envVariable(args);
      case 'powershell_clipboard':      return await clipboardAction(args);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) { return { error: `PowerShell error: ${err.message}` }; }
}

export async function detect() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'echo ok'], { timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch { return false; }
}

export const name = 'powershell';
export const description = 'PowerShell execution, COM automation, registry, WMI, services, system info, clipboard';
