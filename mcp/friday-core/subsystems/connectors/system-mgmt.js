/**
 * System Management Connector -- Windows system administration
 *
 * Ported from nexus-os: connectors/system-management.ts (1,112 lines)
 * Provides: services, scheduled tasks, network, firewall, package managers,
 * disk usage, performance, event logs.
 *
 * All commands run via powershell.exe -NoProfile -Command.
 * Elevation failures reported gracefully with guidance.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 120_000;
const ELEVATION_HINT = 'This operation may require elevated (Administrator) privileges.';

async function ps(command, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true,
  });
  return (stdout ?? '').trim();
}

function truncate(text, limit = MAX_OUTPUT_CHARS) {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n--- truncated (${text.length} chars total) ---`;
}

function ok(text) { return { result: truncate(text.trim()) || '(no output)' }; }
function fail(msg) {
  const lower = msg.toLowerCase();
  if (lower.includes('access is denied') || lower.includes('access denied') || lower.includes('requires elevation') || lower.includes('not have permission')) {
    return { error: `${msg}\n\n${ELEVATION_HINT}` };
  }
  return { error: msg };
}

async function safeRun(command, timeoutMs) {
  try { return ok(await ps(command, timeoutMs)); }
  catch (err) { return fail(err instanceof Error ? err.message : String(err)); }
}

function psEsc(value) { return value.replace(/'/g, "''"); }

// -- Services --

async function servicesList(args) {
  let script = 'Get-Service';
  const conditions = [];
  if (args.filter) conditions.push(`$_.DisplayName -like '*${psEsc(args.filter)}*'`);
  if (args.status) conditions.push(`$_.Status -eq '${psEsc(args.status)}'`);
  if (conditions.length > 0) script += ` | Where-Object { ${conditions.join(' -and ')} }`;
  script += " | Sort-Object DisplayName | Format-Table -AutoSize Name, DisplayName, Status, StartType | Out-String -Width 300";
  return safeRun(script);
}

async function serviceControl(args) {
  if (!args.service_name) return fail('service_name is required.');
  const safeName = psEsc(args.service_name);
  let script;
  switch (args.action) {
    case 'start': script = `Start-Service -Name '${safeName}' -ErrorAction Stop; Get-Service -Name '${safeName}' | Format-List Name, DisplayName, Status | Out-String -Width 300`; break;
    case 'stop': script = `Stop-Service -Name '${safeName}' -Force -ErrorAction Stop; Get-Service -Name '${safeName}' | Format-List Name, DisplayName, Status | Out-String -Width 300`; break;
    case 'restart': script = `Restart-Service -Name '${safeName}' -Force -ErrorAction Stop; Get-Service -Name '${safeName}' | Format-List Name, DisplayName, Status | Out-String -Width 300`; break;
    default: return fail(`Unknown action: ${args.action}`);
  }
  return safeRun(script);
}

async function serviceInfo(args) {
  if (!args.service_name) return fail('service_name is required.');
  const safeName = psEsc(args.service_name);
  const script = `
$svc = Get-Service -Name '${safeName}' -ErrorAction Stop
$wmi = Get-CimInstance Win32_Service -Filter "Name='${safeName}'" -ErrorAction SilentlyContinue
[PSCustomObject]@{
  Name = $svc.Name; DisplayName = $svc.DisplayName; Status = $svc.Status; StartType = $svc.StartType
  PathName = if ($wmi) { $wmi.PathName } else { 'N/A' }
  Description = if ($wmi) { $wmi.Description } else { 'N/A' }
} | Format-List | Out-String -Width 300`.trim();
  return safeRun(script);
}

// -- Scheduled Tasks --

async function scheduledTaskList(args) {
  let script = args.path ? `Get-ScheduledTask -TaskPath '${psEsc(args.path)}' -ErrorAction SilentlyContinue` : 'Get-ScheduledTask -ErrorAction SilentlyContinue';
  script += " | Select-Object TaskName, TaskPath, State | Format-Table -AutoSize | Out-String -Width 300";
  return safeRun(script);
}

async function scheduledTaskCreate(args) {
  if (!args.task_name || !args.program || !args.trigger_type) return fail('task_name, program, and trigger_type required.');
  const lines = [];
  lines.push(args.arguments
    ? `$action = New-ScheduledTaskAction -Execute '${psEsc(args.program)}' -Argument '${psEsc(args.arguments)}'`
    : `$action = New-ScheduledTaskAction -Execute '${psEsc(args.program)}'`);
  switch (args.trigger_type) {
    case 'once': if (!args.trigger_time) return fail('trigger_time required.'); lines.push(`$trigger = New-ScheduledTaskTrigger -Once -At '${psEsc(args.trigger_time)}'`); break;
    case 'daily': if (!args.trigger_time) return fail('trigger_time required.'); lines.push(`$trigger = New-ScheduledTaskTrigger -Daily -At '${psEsc(args.trigger_time)}'`); break;
    case 'weekly': if (!args.trigger_time) return fail('trigger_time required.'); lines.push(`$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '${psEsc(args.trigger_time)}'`); break;
    case 'logon': lines.push('$trigger = New-ScheduledTaskTrigger -AtLogOn'); break;
    case 'startup': lines.push('$trigger = New-ScheduledTaskTrigger -AtStartup'); break;
    default: return fail(`Unknown trigger_type: ${args.trigger_type}`);
  }
  let registerCmd = `Register-ScheduledTask -TaskName '${psEsc(args.task_name)}' -Action $action -Trigger $trigger -Force`;
  if (args.description) registerCmd += ` -Description '${psEsc(args.description)}'`;
  lines.push(registerCmd);
  return safeRun(lines.join('\n'));
}

async function scheduledTaskDelete(args) {
  if (!args.task_name) return fail('task_name required.');
  return safeRun(`Unregister-ScheduledTask -TaskName '${psEsc(args.task_name)}' -Confirm:$false -ErrorAction Stop; Write-Output "Deleted '${psEsc(args.task_name)}'"`);
}

async function scheduledTaskRun(args) {
  if (!args.task_name) return fail('task_name required.');
  return safeRun(`Start-ScheduledTask -TaskName '${psEsc(args.task_name)}' -ErrorAction Stop; Write-Output "Started '${psEsc(args.task_name)}'"`);
}

// -- Network --

async function networkInfo() {
  const script = `
$adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' }
foreach ($a in $adapters) {
  $ip = Get-NetIPAddress -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue | Where-Object { $_.AddressFamily -eq 'IPv4' }
  [PSCustomObject]@{ Adapter=$a.Name; Status=$a.Status; Speed=$a.LinkSpeed; MAC=$a.MacAddress; IPv4=($ip.IPAddress -join ', ') }
}`.trim() + ' | Format-List | Out-String -Width 300';
  return safeRun(script);
}

async function networkConnections(args) {
  const lines = ['$c = Get-NetTCPConnection -ErrorAction SilentlyContinue'];
  const filters = [];
  if (args.state) filters.push(`$_.State -eq '${psEsc(args.state)}'`);
  if (args.process_name) { lines.push(`$pids = (Get-Process -Name '${psEsc(args.process_name)}' -ErrorAction SilentlyContinue).Id`); filters.push('$pids -contains $_.OwningProcess'); }
  if (filters.length > 0) lines.push(`$c = $c | Where-Object { ${filters.join(' -and ')} }`);
  lines.push("$c | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, State, @{N='Process';E={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}} | Format-Table -AutoSize | Out-String -Width 300");
  return safeRun(lines.join('\n'));
}

// -- Firewall --

async function firewallRules(args) {
  let script = 'Get-NetFirewallRule -ErrorAction SilentlyContinue';
  const conditions = [];
  if (args.filter) conditions.push(`$_.DisplayName -like '*${psEsc(args.filter)}*'`);
  if (args.direction) conditions.push(`$_.Direction -eq '${psEsc(args.direction)}'`);
  if (args.action) conditions.push(`$_.Action -eq '${psEsc(args.action)}'`);
  if (conditions.length > 0) script += ` | Where-Object { ${conditions.join(' -and ')} }`;
  script += ' | Select-Object -First 50 DisplayName, Direction, Action, Enabled | Format-Table -AutoSize | Out-String -Width 300';
  return safeRun(script);
}

async function firewallAddRule(args) {
  if (!args.name || !args.direction || !args.action) return fail('name, direction, action required.');
  const parts = [`New-NetFirewallRule -DisplayName '${psEsc(args.name)}'`, `-Direction ${args.direction}`, `-Action ${args.action}`, `-Protocol ${args.protocol || 'TCP'}`];
  if (args.local_port) parts.push(`-LocalPort ${psEsc(args.local_port)}`);
  if (args.remote_address) parts.push(`-RemoteAddress '${psEsc(args.remote_address)}'`);
  if (args.program) parts.push(`-Program '${psEsc(args.program)}'`);
  parts.push('-ErrorAction Stop');
  return safeRun(parts.join(' ') + `; Write-Output "Rule '${psEsc(args.name)}' created."`);
}

// -- Package Managers --

async function packageInstall(args) {
  if (!args.package_id) return fail('package_id required.');
  const manager = args.manager || 'winget';
  let script;
  switch (manager) {
    case 'winget': script = `winget install --id '${psEsc(args.package_id)}' --accept-package-agreements --accept-source-agreements`; if (args.version) script += ` --version '${psEsc(args.version)}'`; break;
    case 'choco': script = `choco install ${psEsc(args.package_id)} -y --no-progress`; if (args.version) script += ` --version ${psEsc(args.version)}`; break;
    case 'scoop': script = `scoop install ${psEsc(args.package_id)}`; break;
    default: return fail(`Unknown manager: ${manager}`);
  }
  return safeRun(script, INSTALL_TIMEOUT_MS);
}

async function packageSearch(args) {
  if (!args.query) return fail('query required.');
  const manager = args.manager || 'winget';
  switch (manager) {
    case 'winget': return safeRun(`winget search '${psEsc(args.query)}' --accept-source-agreements`);
    case 'choco': return safeRun(`choco search ${psEsc(args.query)} --limit-output`);
    case 'scoop': return safeRun(`scoop search ${psEsc(args.query)}`);
    default: return fail(`Unknown manager: ${manager}`);
  }
}

async function packageList(args) {
  const manager = args.manager || 'winget';
  switch (manager) {
    case 'winget': return safeRun('winget list --accept-source-agreements');
    case 'choco': return safeRun('choco list --local-only --limit-output');
    case 'scoop': return safeRun('scoop list');
    default: return fail(`Unknown manager: ${manager}`);
  }
}

// -- Disk & Performance --

async function diskUsage(args) {
  let filter = "DriveType=3";
  if (args.drive) { const letter = args.drive.replace(':', '').toUpperCase(); filter += ` AND DeviceID='${letter}:'`; }
  const script = `
$disks = Get-CimInstance Win32_LogicalDisk -Filter "${filter}"
foreach ($d in $disks) {
  $total = [math]::Round($d.Size / 1GB, 2); $free = [math]::Round($d.FreeSpace / 1GB, 2)
  $used = [math]::Round(($d.Size - $d.FreeSpace) / 1GB, 2)
  $pct = if ($d.Size -gt 0) { [math]::Round(($d.Size - $d.FreeSpace) / $d.Size * 100, 1) } else { 0 }
  [PSCustomObject]@{ Drive=$d.DeviceID; 'Total(GB)'=$total; 'Used(GB)'=$used; 'Free(GB)'=$free; 'Used%'="$pct%" }
}`.trim() + ' | Format-Table -AutoSize | Out-String -Width 300';
  return safeRun(script);
}

async function performanceInfo() {
  const script = `
$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$os = Get-CimInstance Win32_OperatingSystem
$totalMem = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
$freeMem = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
$memPct = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize * 100, 1)
Write-Output "CPU: $cpu% | Memory: $([math]::Round($totalMem - $freeMem, 2))/$totalMem GB ($memPct%)"
Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Name, Id, @{N='CPU(s)';E={[math]::Round($_.CPU, 1)}}, @{N='Mem(MB)';E={[math]::Round($_.WorkingSet64 / 1MB, 1)}} | Format-Table -AutoSize | Out-String -Width 300`.trim();
  return safeRun(script);
}

// -- Event Log --

async function eventLog(args) {
  const logName = args.log_name || 'System';
  const count = Math.min(Math.max(args.count || 20, 1), 100);
  const levelMap = { critical: 1, error: 2, warning: 3, information: 4 };
  let filterHash = `@{LogName='${psEsc(logName)}'`;
  if (args.level) { const n = levelMap[args.level.toLowerCase()]; if (n !== undefined) filterHash += `; Level=${n}`; }
  filterHash += '}';
  const script = `Get-WinEvent -FilterHashtable ${filterHash} -MaxEvents ${count} -ErrorAction SilentlyContinue | Select-Object TimeCreated, LevelDisplayName, Id, ProviderName, @{N='Message';E={($_.Message -split '\\n')[0]}} | Format-Table -AutoSize -Wrap | Out-String -Width 300`;
  return safeRun(script);
}

// -- Exports --

export function getTools() {
  return [
    { name: 'sys_services_list', description: 'List Windows services', params: { filter: 'string', status: 'string' }, safety_level: 'read_only', category: 'system' },
    { name: 'sys_service_control', description: 'Start/stop/restart a Windows service', params: { service_name: 'string', action: 'start|stop|restart' }, safety_level: 'write', category: 'system' },
    { name: 'sys_service_info', description: 'Get detailed info about a Windows service', params: { service_name: 'string' }, safety_level: 'read_only', category: 'system' },
    { name: 'sys_scheduled_task_list', description: 'List scheduled tasks', params: { path: 'string' }, safety_level: 'read_only', category: 'automation' },
    { name: 'sys_scheduled_task_create', description: 'Create a scheduled task', params: { task_name: 'string', program: 'string', trigger_type: 'string', trigger_time: 'string' }, safety_level: 'write', category: 'automation' },
    { name: 'sys_scheduled_task_delete', description: 'Delete a scheduled task', params: { task_name: 'string' }, safety_level: 'destructive', category: 'automation' },
    { name: 'sys_scheduled_task_run', description: 'Immediately run a scheduled task', params: { task_name: 'string' }, safety_level: 'write', category: 'automation' },
    { name: 'sys_network_info', description: 'Get network interface info (adapters, IPs, MACs)', params: {}, safety_level: 'read_only', category: 'system' },
    { name: 'sys_network_connections', description: 'List active network connections', params: { state: 'string', process_name: 'string' }, safety_level: 'read_only', category: 'system' },
    { name: 'sys_firewall_rules', description: 'List Windows Firewall rules', params: { filter: 'string', direction: 'string', action: 'string' }, safety_level: 'read_only', category: 'system' },
    { name: 'sys_firewall_add_rule', description: 'Add a firewall rule (requires elevation)', params: { name: 'string', direction: 'string', action: 'string', protocol: 'string', local_port: 'string' }, safety_level: 'write', category: 'system' },
    { name: 'sys_package_install', description: 'Install a package via winget/choco/scoop', params: { package_id: 'string', manager: 'string', version: 'string' }, safety_level: 'write', category: 'system' },
    { name: 'sys_package_search', description: 'Search for packages', params: { query: 'string', manager: 'string' }, safety_level: 'read_only', category: 'system' },
    { name: 'sys_package_list', description: 'List installed packages', params: { manager: 'string' }, safety_level: 'read_only', category: 'system' },
    { name: 'sys_disk_usage', description: 'Get disk usage for fixed drives', params: { drive: 'string' }, safety_level: 'read_only', category: 'system' },
    { name: 'sys_performance_info', description: 'Get CPU, memory, top processes', params: {}, safety_level: 'read_only', category: 'system' },
    { name: 'sys_event_log', description: 'Read Windows event log entries', params: { log_name: 'string', count: 'number', level: 'string' }, safety_level: 'read_only', category: 'system' },
  ];
}

export async function execute(toolName, args) {
  try {
    switch (toolName) {
      case 'sys_services_list':         return await servicesList(args);
      case 'sys_service_control':       return await serviceControl(args);
      case 'sys_service_info':          return await serviceInfo(args);
      case 'sys_scheduled_task_list':   return await scheduledTaskList(args);
      case 'sys_scheduled_task_create': return await scheduledTaskCreate(args);
      case 'sys_scheduled_task_delete': return await scheduledTaskDelete(args);
      case 'sys_scheduled_task_run':    return await scheduledTaskRun(args);
      case 'sys_network_info':          return await networkInfo();
      case 'sys_network_connections':   return await networkConnections(args);
      case 'sys_firewall_rules':        return await firewallRules(args);
      case 'sys_firewall_add_rule':     return await firewallAddRule(args);
      case 'sys_package_install':       return await packageInstall(args);
      case 'sys_package_search':        return await packageSearch(args);
      case 'sys_package_list':          return await packageList(args);
      case 'sys_disk_usage':            return await diskUsage(args);
      case 'sys_performance_info':      return await performanceInfo();
      case 'sys_event_log':             return await eventLog(args);
      default: return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) { return { error: `system-management error: ${err.message}` }; }
}

export async function detect() {
  // Only available on Windows
  return process.platform === 'win32';
}

export const name = 'system-management';
export const description = 'Windows services, scheduled tasks, network, firewall, packages, disk, performance, event logs';
