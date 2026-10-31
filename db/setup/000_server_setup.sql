/*
  AptLog 서버 수준 초기 설정 (DB·로그인·DB 사용자). 재실행 안전.
  sysadmin 권한으로 실행: scripts/setup-sqlserver.ps1 이 sqlcmd 변수와 함께 호출한다.

  변수
    ENV_UC  : DEV | PROD
    ENV_LC  : dev | prod
    APP_PW  : aptlog_{env}_app 비밀번호
    MIG_PW  : aptlog_{env}_mig 비밀번호

  가계 시스템(hh_{env}_app / hh_{env}_mig)과 같은 명명 규칙.
  런타임 권한(DENY UPDATE/DELETE 등)은 마이그레이션 002_app_role.sql 에서 부여한다.
*/
SET NOCOUNT ON;

IF DB_ID(N'RealtyLog_$(ENV_UC)') IS NULL
BEGIN
    CREATE DATABASE [RealtyLog_$(ENV_UC)] COLLATE Korean_Wansung_CI_AS;
    PRINT N'CREATE DATABASE RealtyLog_$(ENV_UC)';
END
GO

ALTER DATABASE [RealtyLog_$(ENV_UC)] SET COMPATIBILITY_LEVEL = 170;
ALTER DATABASE [RealtyLog_$(ENV_UC)] SET RECOVERY SIMPLE;
GO

IF SUSER_ID(N'aptlog_$(ENV_LC)_app') IS NULL
BEGIN
    CREATE LOGIN [aptlog_$(ENV_LC)_app] WITH PASSWORD = N'$(APP_PW)',
        DEFAULT_DATABASE = [RealtyLog_$(ENV_UC)], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
    PRINT N'CREATE LOGIN aptlog_$(ENV_LC)_app';
END

IF SUSER_ID(N'aptlog_$(ENV_LC)_mig') IS NULL
BEGIN
    CREATE LOGIN [aptlog_$(ENV_LC)_mig] WITH PASSWORD = N'$(MIG_PW)',
        DEFAULT_DATABASE = [RealtyLog_$(ENV_UC)], CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;
    PRINT N'CREATE LOGIN aptlog_$(ENV_LC)_mig';
END
GO

USE [RealtyLog_$(ENV_UC)];
GO

IF USER_ID(N'aptlog_$(ENV_LC)_app') IS NULL
    CREATE USER [aptlog_$(ENV_LC)_app] FOR LOGIN [aptlog_$(ENV_LC)_app];
IF USER_ID(N'aptlog_$(ENV_LC)_mig') IS NULL
    CREATE USER [aptlog_$(ENV_LC)_mig] FOR LOGIN [aptlog_$(ENV_LC)_mig];

IF IS_ROLEMEMBER(N'db_owner', N'aptlog_$(ENV_LC)_mig') = 0
    ALTER ROLE db_owner ADD MEMBER [aptlog_$(ENV_LC)_mig];
GO

PRINT N'RealtyLog_$(ENV_UC) 설정 완료';
