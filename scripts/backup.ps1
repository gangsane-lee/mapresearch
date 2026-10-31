<#
  AptLog 백업 (계획서 §8) — 작업 스케줄러에서 일 1회 실행 (scripts\register-backup-task.ps1)
    1. RealtyLog_DEV / RealtyLog_PROD 중 존재하는 DB를 BACKUP_ROOT\db\{DB}_{yyyyMMdd}.bak 로 백업 (CHECKSUM + VERIFYONLY)
    2. 보관 정리: BACKUP_ROOT\db 의 RealtyLog_{DEV|PROD}_yyyyMMdd.bak 중 14일 경과분만 삭제 (유일한 자동 삭제 예외)
    3. 미디어: robocopy /E /XO (/MIR 금지 — 원본 삭제가 백업까지 전파되지 않도록). 미디어 백업은 정리하지 않음
    4. BACKUP_ROOT\logs\last_backup.json 기록 (설정 화면 표시용)

  SQL Server Express는 백업 압축 미지원 → 압축 옵션 없음.
#>
param(
    [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env'),
    [string]$Instance = '.\SQLEXPRESS',
    [int]$RetentionDays = 14
)
$ErrorActionPreference = 'Stop'

function Read-DotEnv([string]$file) {
    $map = @{}
    if (-not (Test-Path $file)) { throw ".env 없음: $file" }
    foreach ($line in Get-Content -Path $file -Encoding UTF8) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { $map[$Matches[1]] = $Matches[2].Trim() }
    }
    return $map
}

$cfg = Read-DotEnv $EnvFile
$backupRoot = $cfg['BACKUP_ROOT']; $mediaRoot = $cfg['MEDIA_ROOT']
if (-not $backupRoot -or -not $mediaRoot) { throw '.env 에 BACKUP_ROOT, MEDIA_ROOT 가 필요합니다' }

$today = Get-Date -Format 'yyyyMMdd'
$dbDir = Join-Path $backupRoot 'db'; $mediaDir = Join-Path $backupRoot 'media'; $logDir = Join-Path $backupRoot 'logs'
foreach ($d in @($dbDir, $mediaDir, $logDir)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null } }
$log = Join-Path $logDir "backup_$today.log"
function Log([string]$msg) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"; Write-Host $line; Add-Content -Path $log -Value $line -Encoding UTF8 }

$result = [ordered]@{ startedAt = (Get-Date).ToString('s'); databases = @(); media = $null; deleted = @(); ok = $false; sameDisk = $false }
try {
    if ([IO.Path]::GetPathRoot((Resolve-Path $backupRoot).Path) -eq [IO.Path]::GetPathRoot($mediaRoot)) {
        $result.sameDisk = $true
        Log '경고: 백업이 원본과 같은 디스크에 있습니다 (디스크 고장 시 함께 손실)'
    }

    # 1) DB 백업
    $existing = & sqlcmd -S "lpc:$Instance" -E -C -h -1 -W -b -Q "SET NOCOUNT ON; SELECT name FROM sys.databases WHERE name IN ('RealtyLog_DEV','RealtyLog_PROD') AND state = 0"
    if ($LASTEXITCODE -ne 0) { throw "DB 목록 조회 실패 (exit $LASTEXITCODE)" }
    foreach ($db in ($existing | Where-Object { $_ -match '^RealtyLog_(DEV|PROD)$' })) {
        $file = Join-Path $dbDir "${db}_$today.bak"
        Log "BACKUP $db → $file"
        & sqlcmd -S "lpc:$Instance" -E -C -b -Q "BACKUP DATABASE [$db] TO DISK = N'$file' WITH INIT, CHECKSUM; RESTORE VERIFYONLY FROM DISK = N'$file' WITH CHECKSUM;" | ForEach-Object { Log "  $_" }
        if ($LASTEXITCODE -ne 0) { throw "$db 백업 실패 (exit $LASTEXITCODE)" }
        $result.databases += [ordered]@{ name = $db; file = $file; bytes = (Get-Item $file).Length }
    }

    # 2) 보관 정리 — 지정 패턴만
    $cutoff = (Get-Date).Date.AddDays(-$RetentionDays)
    Get-ChildItem -Path $dbDir -File -Filter 'RealtyLog_*.bak' |
        Where-Object { $_.Name -match '^RealtyLog_(DEV|PROD)_(\d{8})\.bak$' -and [datetime]::ParseExact($Matches[2], 'yyyyMMdd', $null) -lt $cutoff } |
        ForEach-Object {
            Log "보관기간 경과 삭제: $($_.FullName)"
            $result.deleted += $_.Name
            Remove-Item -LiteralPath $_.FullName
        }

    # 3) 미디어 증분 복사
    if (Test-Path $mediaRoot) {
        & robocopy $mediaRoot $mediaDir /E /XO /R:2 /W:5 /NP /NDL /NJH /UNILOG+:$log | Out-Null
        $rc = $LASTEXITCODE
        if ($rc -ge 8) { throw "robocopy 실패 (exit $rc)" }
        $result.media = [ordered]@{ robocopyExit = $rc }
        Log "미디어 복사 완료 (robocopy exit $rc)"
    } else {
        Log "미디어 폴더 없음, 건너뜀: $mediaRoot"
    }

    $result.ok = $true
} catch {
    Log "실패: $($_.Exception.Message)"
    $result.error = $_.Exception.Message
    $exitCode = 1
} finally {
    $result.endedAt = (Get-Date).ToString('s')
    $result | ConvertTo-Json -Depth 4 | Out-File -FilePath (Join-Path $logDir 'last_backup.json') -Encoding utf8
}
exit $(if ($exitCode) { $exitCode } else { 0 })
