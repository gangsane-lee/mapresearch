<#
  AptLog 백업을 Windows 작업 스케줄러에 등록 (사용자가 직접 실행)
    - 매일 지정 시각, PC가 꺼져 있었으면 켜진 뒤 실행 (StartWhenAvailable)
    - 현재 사용자 권한으로 실행 (sqlcmd Windows 인증)
  사용: powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1 [-At 21:00]
#>
param([string]$At = '21:00', [string]$TaskName = 'AptLog Backup')
$ErrorActionPreference = 'Stop'
$script = (Resolve-Path (Join-Path $PSScriptRoot 'backup.ps1')).Path
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'AptLog DB 백업 + 미디어 증분 복사' -Force | Out-Null
Write-Host "등록 완료: '$TaskName' 매일 $At"
