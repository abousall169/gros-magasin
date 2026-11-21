# Installe le démarrage automatique de la caisse (tâche planifiée Windows + ouverture du pare-feu sur le réseau local).
#   -Mode Boot  (défaut) : démarre avec le PC, avant même l'ouverture de session. Demande les droits administrateur.
#   -Mode Logon          : démarre à l'ouverture de session de l'utilisateur courant. Pas besoin d'être administrateur.
param(
  [ValidateSet('Boot', 'Logon')][string]$Mode = 'Boot',
  [string]$TaskName = 'CaisseGrosDetail',
  [switch]$PreventSleep,         # empêche la mise en veille du PC sur secteur (recommandé pour un serveur de magasin)
  [string]$DataDir, [int]$Port, [int]$HttpsPort   # surcharges (tests)
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
# Arrête toute instance de la caisse de CE dossier (script de relance + serveur node), même orpheline.
function Stop-CaisseProcesses {
  $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  $mine = @($all | Where-Object { $_.CommandLine -and $_.ProcessId -ne $PID -and (
      ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like "*$root\scripts\serveur.ps1*") -or
      ($_.Name -eq 'node.exe' -and $_.CommandLine -like "*$root\server\index.js*")) })
  # d'abord les scripts de relance (sinon ils relanceraient le serveur), puis les serveurs
  foreach ($p in ($mine | Sort-Object { $_.Name -ne 'powershell.exe' })) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($mine.Count) { Start-Sleep -Seconds 1 }
}
function Step($m) { Write-Host "> $m" -ForegroundColor Green }

if ($Mode -eq 'Boot' -and -not $isAdmin) { throw "Le mode Boot demande les droits administrateur : utilisez installer-demarrage-auto.bat (il demande l'autorisation) ou -Mode Logon." }

# 1) Node.js 22.13 ou plus récent
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js est introuvable. Installez la version LTS de Node.js (https://nodejs.org) puis relancez." }
$ver = (& $node -v).TrimStart('v').Split('.')
$major = [int]$ver[0]; $minor = [int]$ver[1]
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) { throw "Node.js $(& $node -v) détecté : la version 22.13 ou plus récente est nécessaire." }
Step "Node.js $(& $node -v) : $node"

# 2) Dépendances (et modèle de reconnaissance par photo, téléchargé une fois)
Push-Location $root
try {
  if (-not (Test-Path 'node_modules\node-forge')) { Step 'Installation des dépendances (npm install)…'; cmd /c 'npm install --omit=dev --no-audit --no-fund'; if ($LASTEXITCODE) { throw 'npm install a échoué' } }
} finally { Pop-Location }

$http = if ($Port) { $Port } else { 3000 }
$https = if ($HttpsPort) { $HttpsPort } else { 3443 }

# 3) Pare-feu : ouvre les ports pour le réseau local UNIQUEMENT (le Wi-Fi est souvent classé « Public », ce qui bloque les téléphones)
$ruleName = if ($TaskName -eq 'CaisseGrosDetail') { 'Caisse Gros et Detail (reseau local)' } else { "Caisse Gros et Detail ($TaskName)" }
if ($isAdmin) {
  Step "Pare-feu : ports $http et $https ouverts pour le réseau local"
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $http, $https -Profile Any -RemoteAddress LocalSubnet | Out-Null
} else {
  Write-Warning "Pas administrateur : règle de pare-feu non créée. Si les téléphones n'arrivent pas à se connecter, relancez avec installer-demarrage-auto.bat."
}

# 4) Tâche planifiée
$argList = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$root\scripts\serveur.ps1`" -NodePath `"$node`""
if ($DataDir)   { $argList += " -DataDir `"$DataDir`"" }
if ($Port)      { $argList += " -Port $Port" }
if ($HttpsPort) { $argList += " -HttpsPort $HttpsPort" }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argList -WorkingDirectory $root
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if ($Mode -eq 'Boot') {
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
} else {
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
Step "Tâche planifiée « $TaskName » ($Mode)"
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | ForEach-Object { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
Stop-CaisseProcesses   # un serveur lancé à la main ou resté orphelin bloquerait le port
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'Serveur de la caisse gros et détail (démarrage automatique)' -Force | Out-Null

# 5) Veille
if ($PreventSleep) {
  if ($isAdmin) { Step 'Mise en veille désactivée sur secteur'; powercfg /change standby-timeout-ac 0; powercfg /change hibernate-timeout-ac 0 }
  else { Write-Warning "Désactivation de la veille ignorée (droits administrateur requis)." }
}

# 6) Démarrage immédiat + vérification
Step 'Démarrage du serveur…'
Start-ScheduledTask -TaskName $TaskName
$ok = $false
$lastErr = ''
foreach ($i in 1..40) {
  Start-Sleep -Seconds 1
  try { if ((Invoke-RestMethod "http://127.0.0.1:$http/api/health" -TimeoutSec 3).app -eq 'grand-magasin') { $ok = $true; break } } catch { $lastErr = $_.Exception.Message }
}
if (-not $ok) { throw "Le serveur ne répond pas sur le port $http ($lastErr). Consultez le journal : $(if ($DataDir) { $DataDir } else { Join-Path $root 'data' })\logs\" }
Write-Host "`nCaisse en marche et démarrage automatique installé." -ForegroundColor Green
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
  ForEach-Object { Write-Host "   Téléphones / tablettes : https://$($_.IPAddress):$https   (1re fois sur un appareil : http://$($_.IPAddress):$http/install)" }
if ($Mode -eq 'Boot') { Write-Host "   Le serveur tourne sous le compte système : une imprimante installée seulement pour votre utilisateur peut ne pas être visible. Dans ce cas, utilisez -Mode Logon." }
