<#
  AptLog API를 Windows 서비스로 등록 (WinSW, 계획서 §2.1) — 관리자 PowerShell에서 직접 실행
    1) WinSW x64 실행 파일을 https://github.com/winsw/winsw/releases 에서 받아
       scripts\service\aptlog.exe 로 저장 (WinSW 실행 파일 이름 = 서비스 설정 XML 이름)
    2) npm run build (web/dist 생성 — Express가 정적 서빙)
    3) 이 스크립트 실행 → aptlog.xml 생성 후 install/start
  사용: powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1 [-Uninstall]
#>
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$svcDir = Join-Path $PSScriptRoot 'service'
$exe = Join-Path $svcDir 'aptlog.exe'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw '관리자 권한 PowerShell에서 실행하세요'
}
if (-not (Test-Path $exe)) { throw "WinSW 실행 파일이 없습니다: $exe (스크립트 상단 안내 참조)" }

if ($Uninstall) {
    & $exe stop | Out-Null
    & $exe uninstall
    exit $LASTEXITCODE
}

$node = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $root 'web\dist\index.html'))) { throw 'web\dist 가 없습니다. 먼저 npm run build' }
if (-not (Test-Path (Join-Path $root '.env'))) { throw '.env 가 없습니다' }

$xml = @"
<service>
  <id>AptLog</id>
  <name>AptLog</name>
  <description>AptLog 아파트 임장·스냅샷 기록 (Express API + SPA)</description>
  <executable>$node</executable>
  <arguments>--env-file="$root\.env" "$root\api\src\server.js"</arguments>
  <workingdirectory>$root\api</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <depend>MSSQL`$SQLEXPRESS</depend>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
  <logpath>$svcDir\logs</logpath>
</service>
"@
$xml | Out-File -FilePath (Join-Path $svcDir 'aptlog.xml') -Encoding utf8
& $exe install
if ($LASTEXITCODE -ne 0) { throw "서비스 등록 실패 (exit $LASTEXITCODE)" }
& $exe start
Write-Host '서비스 등록·시작 완료: AptLog (SQL Server 서비스 이후 자동 시작)'
