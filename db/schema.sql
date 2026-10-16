-- Fabric Credit Ratings schema. Batches are separated by GO lines; every batch is idempotent.

IF OBJECT_ID('dbo.workloads') IS NULL
CREATE TABLE dbo.workloads (
  id varchar(64) NOT NULL CONSTRAINT pk_workloads PRIMARY KEY,
  name nvarchar(100) NOT NULL,
  short_name nvarchar(30) NOT NULL,
  blurb nvarchar(300) NOT NULL,
  sort_order int NOT NULL,
  updated_at datetime2 NOT NULL CONSTRAINT df_workloads_updated DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.artifacts') IS NULL
CREATE TABLE dbo.artifacts (
  id varchar(64) NOT NULL CONSTRAINT pk_artifacts PRIMARY KEY,
  name nvarchar(100) NOT NULL,
  workload_id varchar(64) NOT NULL CONSTRAINT fk_artifacts_workload REFERENCES dbo.workloads (id),
  status varchar(10) NOT NULL CONSTRAINT ck_artifacts_status CHECK (status IN ('ga', 'preview', 'retired')),
  sort_order int NOT NULL,
  updated_at datetime2 NOT NULL CONSTRAINT df_artifacts_updated DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.users') IS NULL
CREATE TABLE dbo.users (
  id int IDENTITY(1, 1) NOT NULL CONSTRAINT pk_users PRIMARY KEY,
  login varchar(40) NOT NULL CONSTRAINT ux_users_login UNIQUE,
  display_name nvarchar(80) NOT NULL,
  password_hash varchar(255) NOT NULL,
  role varchar(10) NOT NULL CONSTRAINT ck_users_role CHECK (role IN ('admin', 'rater')),
  active bit NOT NULL CONSTRAINT df_users_active DEFAULT 1,
  created_at datetime2 NOT NULL CONSTRAINT df_users_created DEFAULT SYSUTCDATETIME(),
  password_changed_at datetime2 NOT NULL CONSTRAINT df_users_password_changed DEFAULT SYSUTCDATETIME()
);
GO

IF OBJECT_ID('dbo.sessions') IS NULL
CREATE TABLE dbo.sessions (
  token_hash char(64) NOT NULL CONSTRAINT pk_sessions PRIMARY KEY,
  user_id int NOT NULL CONSTRAINT fk_sessions_user REFERENCES dbo.users (id),
  created_at datetime2 NOT NULL CONSTRAINT df_sessions_created DEFAULT SYSUTCDATETIME(),
  expires_at datetime2 NOT NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_sessions_user' AND object_id = OBJECT_ID('dbo.sessions'))
CREATE INDEX ix_sessions_user ON dbo.sessions (user_id);
GO

IF OBJECT_ID('dbo.login_attempts') IS NULL
CREATE TABLE dbo.login_attempts (
  attempt_key varchar(100) NOT NULL CONSTRAINT pk_login_attempts PRIMARY KEY,
  failures int NOT NULL,
  window_start datetime2 NOT NULL,
  locked_until datetime2 NULL
);
GO

IF OBJECT_ID('dbo.rounds') IS NULL
CREATE TABLE dbo.rounds (
  id varchar(8) NOT NULL CONSTRAINT pk_rounds PRIMARY KEY,
  label nvarchar(40) NOT NULL,
  status varchar(10) NOT NULL CONSTRAINT ck_rounds_status CHECK (status IN ('open', 'published')),
  published_on date NULL,
  updated_at datetime2 NOT NULL CONSTRAINT df_rounds_updated DEFAULT SYSUTCDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_rounds_one_open' AND object_id = OBJECT_ID('dbo.rounds'))
CREATE UNIQUE INDEX ux_rounds_one_open ON dbo.rounds (status) WHERE status = 'open';
GO

IF OBJECT_ID('dbo.scores') IS NULL
CREATE TABLE dbo.scores (
  round_id varchar(8) NOT NULL CONSTRAINT fk_scores_round REFERENCES dbo.rounds (id),
  user_id int NOT NULL CONSTRAINT fk_scores_user REFERENCES dbo.users (id),
  artifact_id varchar(64) NOT NULL CONSTRAINT fk_scores_artifact REFERENCES dbo.artifacts (id),
  capability tinyint NOT NULL CONSTRAINT ck_scores_capability CHECK (capability BETWEEN 1 AND 7),
  ux tinyint NOT NULL CONSTRAINT ck_scores_ux CHECK (ux BETWEEN 1 AND 7),
  cost tinyint NOT NULL CONSTRAINT ck_scores_cost CHECK (cost BETWEEN 1 AND 7),
  outlook tinyint NOT NULL CONSTRAINT df_scores_outlook DEFAULT 4 CONSTRAINT ck_scores_outlook CHECK (outlook BETWEEN 1 AND 7),
  updated_at datetime2 NOT NULL CONSTRAINT df_scores_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT pk_scores PRIMARY KEY (round_id, user_id, artifact_id)
);
GO

-- Outlook (Plan 4). Added with a default so rows from before the column survive. The default is kept on purpose: the
-- schema is applied before the new API deploys, and the old API's INSERT names no outlook.
IF COL_LENGTH('dbo.scores', 'outlook') IS NULL
ALTER TABLE dbo.scores ADD outlook tinyint NOT NULL CONSTRAINT df_scores_outlook DEFAULT 4
  CONSTRAINT ck_scores_outlook CHECK (outlook BETWEEN 1 AND 7);
GO

-- A database migrated by an earlier draft of this batch dropped the default; put it back.
IF OBJECT_ID('dbo.df_scores_outlook', 'D') IS NULL
ALTER TABLE dbo.scores ADD CONSTRAINT df_scores_outlook DEFAULT 4 FOR outlook;
GO

-- An artifact delete's foreign-key check seeks this instead of scanning, and waiting on, every card being saved.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_scores_artifact' AND object_id = OBJECT_ID('dbo.scores'))
CREATE INDEX ix_scores_artifact ON dbo.scores (artifact_id);
GO

IF OBJECT_ID('dbo.notes') IS NULL
CREATE TABLE dbo.notes (
  round_id varchar(8) NOT NULL CONSTRAINT fk_notes_round REFERENCES dbo.rounds (id),
  artifact_id varchar(64) NOT NULL CONSTRAINT fk_notes_artifact REFERENCES dbo.artifacts (id),
  body nvarchar(2000) NOT NULL,
  updated_at datetime2 NOT NULL CONSTRAINT df_notes_updated DEFAULT SYSUTCDATETIME(),
  updated_by int NULL CONSTRAINT fk_notes_user REFERENCES dbo.users (id),
  CONSTRAINT pk_notes PRIMARY KEY (round_id, artifact_id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_notes_artifact' AND object_id = OBJECT_ID('dbo.notes'))
CREATE INDEX ix_notes_artifact ON dbo.notes (artifact_id);
GO

IF OBJECT_ID('dbo.site_state') IS NULL
CREATE TABLE dbo.site_state (
  id int NOT NULL CONSTRAINT pk_site_state PRIMARY KEY CONSTRAINT ck_site_state_single CHECK (id = 1),
  last_snapshot_at datetime2 NULL,
  changed_at datetime2 NULL
);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.site_state)
INSERT INTO dbo.site_state (id) VALUES (1);
