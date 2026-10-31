<#
  백업 복원 테스트 (P0 완료 기준: 백업→복원 1회 성공)
    - 최신 RealtyLog_{Source}_yyyyMMdd.bak 을 별도 DB(RealtyLog_RestoreTest)로 복원 → 테이블 행 수 출력
    - 원본 DB는 건드리지 않는다.
    - 테스트 DB 삭제는 -Cleanup 을 붙였을 때만 (사용자 판단)
  사용: powershell -ExecutionPolicy Bypass -File scripts\restore-test.ps1 [-Source PROD] [-Cleanup]
#>
param(
    [ValidateSet('DEV', 'PROD')][string]$Source = 'DEV',
    [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env'),
    [string]$Instance = '.\SQLEXPRESS',
    [string]$TargetDb = 'RealtyLog_RestoreTest',
    [switch]$Cleanup
)
$ErrorActionPreference = 'Stop'
$backupRoot = (Get-Content -Path $EnvFile -Encoding UTF8 | Where-Object { $_ -match '^\s*BACKUP_ROOT\s*=' } | ForEach-Object { ($_ -split '=', 2)[1].Trim() })
if (-not $backupRoot) { throw '.env 에 BACKUP_ROOT 가 필요합니다' }

if ($Cleanup) {
    & sqlcmd -S "lpc:$Instance" -E -C -b -Q "IF DB_ID(N'$TargetDb') IS NOT NULL BEGIN ALTER DATABASE [$TargetDb] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$TargetDb]; END"
    Write-Host "정리 완료: $TargetDb"
    exit $LASTEXITCODE
}

$bak = Get-ChildItem -Path (Join-Path $backupRoot 'db') -Filter "RealtyLog_${Source}_*.bak" | Sort-Object Name -Descending | Select-Object -First 1
if (-not $bak) { throw "백업 파일 없음: $backupRoot\db\RealtyLog_${Source}_*.bak (먼저 scripts\backup.ps1 실행)" }
Write-Host "복원: $($bak.FullName) → $TargetDb"

# 논리 파일명 조회 후 다른 물리 파일로 MOVE
$files = & sqlcmd -S "lpc:$Instance" -E -C -h -1 -W -s '|' -b -Q "SET NOCOUNT ON; RESTORE FILELISTONLY FROM DISK = N'$($bak.FullName)'"
$dataDir = (& sqlcmd -S "lpc:$Instance" -E -C -h -1 -W -b -Q "SET NOCOUNT ON; SELECT CAST(SERVERPROPERTY('InstanceDefaultDataPath') AS nvarchar(260))").Trim()
$moves = @()
foreach ($row in $files) {
    $cols = $row -split '\|'
    if ($cols.Count -lt 3) { continue }
    $logical = $cols[0]; $type = $cols[2]
    $ext = if ($type -eq 'L') { '_log.ldf' } else { '.mdf' }
    $moves += "MOVE N'$logical' TO N'$(Join-Path $dataDir "$TargetDb$ext")'"
}
& sqlcmd -S "lpc:$Instance" -E -C -b -Q "RESTORE DATABASE [$TargetDb] FROM DISK = N'$($bak.FullName)' WITH REPLACE, CHECKSUM, $($moves -join ', ')"
if ($LASTEXITCODE -ne 0) { throw "복원 실패 (exit $LASTEXITCODE)" }

& sqlcmd -S "lpc:$Instance" -E -C -W -b -d $TargetDb -Q "SET NOCOUNT ON; SELECT t.name AS [table], SUM(p.rows) AS [rows] FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1) GROUP BY t.name ORDER BY t.name; SELECT MAX(version) AS schema_version FROM dbo.schema_version;"
Write-Host ''
Write-Host "복원 테스트 성공. 테스트 DB 삭제: scripts\restore-test.ps1 -Cleanup"
