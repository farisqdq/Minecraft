# Installs (or updates) the Rent Roll phone backup server on this Windows machine.
# Run in an Administrator PowerShell:
#   powershell -ExecutionPolicy Bypass -File install-backup-server.ps1 -Secret <secret from Rent Roll setup>
param(
  [Parameter(Mandatory = $true)][string]$Secret,
  [string]$Domain = "backup.eqal.rentals",
  [string]$DataDir = "C:\PhoneBackups",
  [double]$MinFreeGB = 10,
  [string]$ExeUrl = "https://raw.githubusercontent.com/farisqdq/minecraft/claude/rental-profit-tracker-p2d5xy/phone-backup/dist/rentroll-backup.exe"
)
$ErrorActionPreference = "Stop"
$TaskName = "Rent Roll Phone Backup Server"

function Say($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Open PowerShell with 'Run as administrator' and run this again."
}
if ($Secret.Length -lt 32) { throw "The secret looks wrong (too short). Copy the whole command again." }

Say "Making $DataDir"
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# Stop an older copy so its file can be replaced.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Say "Stopping the old version"
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}
Get-Process rentroll-backup -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Say "Downloading the server"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$exe = Join-Path $DataDir "rentroll-backup.exe"
Invoke-WebRequest -Uri $ExeUrl -OutFile $exe -UseBasicParsing

Say "Writing settings"
$config = [ordered]@{ domain = $Domain; secret = $Secret; dataDir = $DataDir; minFreeGB = $MinFreeGB }
$config | ConvertTo-Json | Set-Content -Path (Join-Path $DataDir "config.json") -Encoding ASCII
# Only Administrators and SYSTEM may read the folder (it holds the secret and everyone's backups).
icacls $DataDir /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" | Out-Null

Say "Checking ports 80 and 443 are free"
foreach ($port in 80, 443) {
  $used = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($used) {
    $p = Get-Process -Id $used[0].OwningProcess -ErrorAction SilentlyContinue
    Write-Warning "Port $port is already used by $($p.ProcessName). The backup server needs it; stop that program first."
  }
}

Say "Opening the firewall for HTTPS"
foreach ($port in 80, 443) {
  $name = "Rent Roll Phone Backup ($port)"
  if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null
  }
}

Say "Setting it to start with Windows and restart if it stops"
$action = New-ScheduledTaskAction -Execute $exe -Argument "-config `"$(Join-Path $DataDir 'config.json')`"" -WorkingDirectory $DataDir
$trigger = New-ScheduledTaskTrigger -AtStartup
# Watchdog: every 2 minutes Windows tries to start it again. If it's already
# running nothing happens (IgnoreNew); if it ever stopped, it's back within 2 min.
$watch = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
$trigger = @($trigger, $watch)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Say "Waiting for the HTTPS certificate (first start can take ~30 seconds)"
$ok = $false
for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
  Start-Sleep -Seconds 3
  try {
    $r = Invoke-RestMethod -Uri "https://$Domain/health" -TimeoutSec 15
    if ($r.ok) { $ok = $true }
  } catch { }
}
if ($ok) {
  Write-Host ""
  Write-Host "Phone backup server is running at https://$Domain" -ForegroundColor Green
  Write-Host "Backups are stored in $DataDir\devices"
} else {
  Write-Warning "The server started, but https://$Domain didn't answer yet. Log: $DataDir\server.log"
  Get-Content (Join-Path $DataDir "server.log") -Tail 15 -ErrorAction SilentlyContinue
}
