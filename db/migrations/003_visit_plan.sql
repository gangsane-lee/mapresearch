/*
  003_visit_plan — A7 임장 일정 (계획서 §10)
  일정은 계획 데이터라 수정 가능(스냅샷 아님). 완료 시 같은 날 스냅샷과 연결.
*/
CREATE TABLE dbo.visit_plan (
    visit_id     int IDENTITY  NOT NULL CONSTRAINT PK_visit_plan PRIMARY KEY,
    complex_id   int           NOT NULL CONSTRAINT FK_visit_plan_complex REFERENCES dbo.complex (complex_id),
    planned_on   date          NOT NULL,
    planned_time time(0)       NULL,
    memo         nvarchar(500) NULL,
    status       varchar(10)   NOT NULL CONSTRAINT DF_visit_plan_status DEFAULT 'PLANNED'
                 CONSTRAINT CK_visit_plan_status CHECK (status IN ('PLANNED','DONE','CANCELED')),
    snapshot_id  bigint        NULL CONSTRAINT FK_visit_plan_snapshot REFERENCES dbo.snapshot (snapshot_id),
    created_at   datetime2(0)  NOT NULL CONSTRAINT DF_visit_plan_created DEFAULT SYSDATETIME(),
    updated_at   datetime2(0)  NOT NULL CONSTRAINT DF_visit_plan_updated DEFAULT SYSDATETIME()
);
CREATE INDEX IX_visit_plan_date ON dbo.visit_plan (planned_on);
