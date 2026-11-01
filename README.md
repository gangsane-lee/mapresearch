# AptLog

아파트 갈아타기 임장·스냅샷 기록 시스템. 기준 문서는 [APTLOG_DEV_PLAN.md](APTLOG_DEV_PLAN.md), 작업 규칙은 [CLAUDE.md](CLAUDE.md), 진행 현황은 [docs/PROGRESS.md](docs/PROGRESS.md).

## 요구 환경

- Windows 10/11, Node.js 24 LTS
- SQL Server 2025 Express `.\SQLEXPRESS` (127.0.0.1:1433, 혼합 인증)
- `sqlcmd` (ODBC Driver 18)

## 처음 설정 (P0)

1. 의존성 설치

   ```bash
   npm install
   ```

2. DB·로그인·폴더 생성 — 직접 실행, 비밀번호를 물어봅니다 (DEV, PROD 각각)

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\setup-sqlserver.ps1 -Env DEV
   ```

3. `.env.example`을 `.env`로 복사하고 2번에서 정한 비밀번호 입력

4. 마이그레이션 + seed

   ```bash
   npm run migrate
   ```

5. 행정경계 빌드 — [vuski/admdongkor](https://github.com/vuski/admdongkor) `ver20260701` 행정동 GeoJSON을 받아 `geo/raw/`에 두고:

   ```bash
   npm run geo:build
   npm run migrate
   ```

   (`db/seed/040_region.sql`이 생성되며, 두 번째 migrate에서 region 테이블에 반영)

6. API 서버

   ```bash
   npm run dev:api
   ```

   `http://127.0.0.1:5180/api/health` 가 `{"ok":true,...}` 이면 정상.

7. 백업 등록 + 복원 테스트

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
   powershell -ExecutionPolicy Bypass -File scripts\restore-test.ps1 -Source DEV
   powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1
   ```

## 테스트

```bash
npm test
```

실DB 통합 테스트는 전용 DB `RealtyLog_TEST`에서만 돕니다 (`setup-sqlserver.ps1 -Env TEST` 후 `.env.test` 작성):

```bash
npm run test:db
```

## 그 밖의 스크립트

- 단지 식별정보 CSV 적재 (한국부동산원 "공동주택 단지 식별정보_기본정보", 분기 1회 정도): `npm run kapt:import -- --file <CSV>` → 확인 후 `--apply` (아파트만, `--kinds 1,2,3` 으로 연립·다세대 포함)
- 실거래 동기화: `npm run trades:sync` (등록 단지 시군구 × 최근 3개월) / `-- --sgg 11620 --months 12`. 매주 자동: `scriptsegister-trade-task.ps1`
- 정비사업 CSV 적재 (연 1회): `node scripts/import-redev.js --file <CSV> --year 2026` → 매핑 확인 후 `--apply`
- 공공 API 응답 확인 (키 발급 후): `node scripts/probe-api.js --lawd 11620 --ym 202608`
- Windows 서비스 등록 (WinSW): `scripts\install-service.ps1` (관리자)

## 복원 절차 (실제 장애 시)

1. 앱 서비스 중지
2. `BACKUP_ROOT\db\RealtyLog_PROD_yyyyMMdd.bak` 중 복원할 파일 선택
3. 관리자 sqlcmd:

   ```
   sqlcmd -S lpc:.\SQLEXPRESS -E -C -Q "RESTORE DATABASE [RealtyLog_PROD] FROM DISK = N'<파일>' WITH REPLACE, CHECKSUM"
   ```

   - 로그인-사용자 매핑이 끊긴 경우: `ALTER USER [aptlog_prod_app] WITH LOGIN = [aptlog_prod_app]` (mig도 동일)
4. 미디어: `robocopy BACKUP_ROOT\media MEDIA_ROOT /E /XO` (원본에 없는 파일만 되돌림)
5. `npm run migrate:status`로 스키마 버전 확인 후 앱 재시작

먼저 `scripts\restore-test.ps1`로 별도 DB에 복원해 내용을 확인한 뒤 실제 복원하는 것을 권장합니다.
