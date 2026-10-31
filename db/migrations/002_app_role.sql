/*
  002_app_role — 앱 런타임 권한 (계획서 §2.1.1)
  - aptlog_app_role: dbo 스키마 CRUD
  - 스냅샷 계열(snapshot, snapshot_value, snapshot_void, commute)은 UPDATE/DELETE 거부 → append-only 강제
  - $(APP_USER) = .env DB_USER (aptlog_dev_app | aptlog_prod_app)
*/
IF DATABASE_PRINCIPAL_ID(N'aptlog_app_role') IS NULL
    CREATE ROLE aptlog_app_role;

GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::dbo TO aptlog_app_role;

DENY UPDATE, DELETE ON dbo.snapshot       TO aptlog_app_role;
DENY UPDATE, DELETE ON dbo.snapshot_value TO aptlog_app_role;
DENY UPDATE, DELETE ON dbo.snapshot_void  TO aptlog_app_role;
DENY UPDATE, DELETE ON dbo.commute        TO aptlog_app_role;
DENY INSERT, UPDATE, DELETE ON dbo.schema_version TO aptlog_app_role;

IF USER_ID(N'$(APP_USER)') IS NULL
    THROW 50001, N'앱 DB 사용자가 없습니다. scripts/setup-sqlserver.ps1 을 먼저 실행하세요.', 1;

IF IS_ROLEMEMBER(N'aptlog_app_role', N'$(APP_USER)') = 0
    ALTER ROLE aptlog_app_role ADD MEMBER [$(APP_USER)];
