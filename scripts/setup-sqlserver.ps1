<#
  AptLog SQL Server 초기 설정 (사용자가 직접 실행)
    - RealtyLog_{ENV} DB, aptlog_{env}_app / aptlog_{env}_mig 로그인 생성 (재실행 안전)
    - 미디어·백업 폴더 생성, SQL Server 서비스 계정에 백업 폴더 쓰기 권한 부여

  사용:  powershell -ExecutionPolicy Bypass -File scripts\setup-sqlserver.ps1 -Env DEV
         (PROD도 같은 방식으로 한 번 더)

  - Windows 인증(현재 사용자 sysadmin)으로 공유 메모리(lpc) 접속. 서비스 재시작 없음.
  - 비밀번호는 화면에 표시되지 않으며, 입력한 값을 .env 의 DB_PASSWORD / MIGRATE_PASSWORD 에 직접 적는다.
#>
param(
    [Parameter(Mandatory)][ValidateSet('DEV', 'PROD', 'TEST')][string]$Env,
    [string]$Instance = '.\SQLEXPRESS',
    [string]$MediaRoot = 'C:\AptLogData\media',
    [string]$BackupRoot = 'C:\AptLogBackup'
)
$ErrorActionPreference = 'Stop'
$envLc = $Env.ToLower()
$sqlFile = Join-Path $PSScriptRoot '..\db\setup\000_server_setup.sql'

function Read-Password([string]$label) {
    while ($true) {
        $s1 = Read-Host "$label 비밀번호" -AsSecureString
        $s2 = Read-Host "$label 비밀번호 확인" -AsSecureString
        $p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1))
        $p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2))
        if ($p1 -ne $p2) { Write-Warning '두 값이 다릅니다.'; continue }
        if ($p1.Length -lt 12) { Write-Warning '12자 이상 입력하세요.'; continue }
        if ($p1 -match "['`"$]") { Write-Warning "작은따옴표('), 큰따옴표(`"), `$ 는 사용할 수 없습니다."; continue }
        return $p1
    }
}

Write-Host "== RealtyLog_$Env 설정 ($Instance) =="
$appPw = Read-Password "aptlog_${envLc}_app"
$migPw = Read-Password "aptlog_${envLc}_mig"

& sqlcmd -S "lpc:$Instance" -E -C -b -I -i $sqlFile `
    -v ENV_UC=$Env ENV_LC=$envLc APP_PW=$appPw MIG_PW=$migPw
if ($LASTEXITCODE -ne 0) { throw "sqlcmd 실패 (exit $LASTEXITCODE)" }

# 폴더 + 백업 폴더 권한 (BACKUP DATABASE 는 SQL Server 서비스 계정이 파일을 쓴다)
$svcAccount = 'NT Service\MSSQL$SQLEXPRESS'
foreach ($d in @($MediaRoot, (Join-Path $BackupRoot 'db'), (Join-Path $BackupRoot 'media'), (Join-Path $BackupRoot 'logs'))) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d | Out-Null; Write-Host "폴더 생성: $d" }
}
& icacls (Join-Path $BackupRoot 'db') /grant "${svcAccount}:(OI)(CI)M" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls 실패 (exit $LASTEXITCODE)" }
Write-Host "권한 부여: $svcAccount → $(Join-Path $BackupRoot 'db') (수정)"

Write-Host ''
Write-Host '완료. .env 에 아래 값을 설정하세요:'
Write-Host "  DB_NAME=RealtyLog_$Env"
Write-Host "  DB_USER=aptlog_${envLc}_app      DB_PASSWORD=(방금 입력한 값)"
Write-Host "  MIGRATE_USER=aptlog_${envLc}_mig  MIGRATE_PASSWORD=(방금 입력한 값)"
Write-Host "  HH_DB=HH_$Env"
