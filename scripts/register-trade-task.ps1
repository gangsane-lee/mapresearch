<#
  실거래 동기화 배치를 Windows 작업 스케줄러에 등록 (사용자가 직접 실행)
    - 매주 지정 요일·시각, 등록 단지의 시군구 × 최근 3개월 (신고 지연 30일·해제 반영)
    - PC가 꺼져 있었으면 켜진 뒤 실행 (StartWhenAvailable). 호출 결과는 sync_log 테이블에 기록
  사용: powershell -ExecutionPolicy Bypass -File scripts\register-trade-task.ps1 [-Day Monday] [-At 07:30]
#>
param([string]$Day = 'Monday', [string]$At = '07:30', [string]$TaskName = 'AptLog Trade Sync')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument 'scripts\sync-trades.js --months 3' -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'AptLog 실거래(매매·전월세) 동기화' -Force | Out-Null
Write-Host "등록 완료: '$TaskName' 매주 $Day $At ($root)"
