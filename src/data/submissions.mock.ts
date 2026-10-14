import type { Outlook, Score, Submission } from '../domain/types';

type Extra = Pick<Submission, 'flag' | 'upside' | 'downside'>;

function entry(
  artifactId: string,
  date: string,
  [capability, ux, cost]: [Score, Score, Score],
  outlook: Outlook,
  note: string,
  extra: Extra = {},
): Submission {
  return { artifactId, date, scores: { capability, ux, cost }, outlook, note, ...extra };
}

/** Example ratings for design review. Not real assessments. */
export const SUBMISSIONS: readonly Submission[] = [
  // Data Engineering
  entry('notebook', '2025-11-14', [6, 6, 5], 'positive', 'Initial rating. Broadest authoring surface in Fabric.'),
  entry('notebook', '2026-04-10', [7, 6, 5], 'stable', 'Python notebooks and T-SQL cells close the remaining capability gaps.'),
  entry(
    'notebook',
    '2026-09-18',
    [7, 7, 5],
    'stable',
    'The most complete authoring surface in Fabric: Spark, pure Python, T-SQL cells, Copilot, and Git integration. Session start-up and idle compute still cost more capacity than they should.',
    {
      upside: ['Idle sessions stop billing within a minute', 'Shared high-concurrency sessions become the default'],
      downside: ['Session start times regress above 30 seconds', 'Python notebook CU rates rise'],
    },
  ),

  entry('copy-job', '2025-11-14', [5, 6, 5], 'positive', 'Initial rating. Simplest way to move data into OneLake.'),
  entry(
    'copy-job',
    '2026-06-12',
    [6, 7, 6],
    'positive',
    'Incremental copy and CDC turned a convenience item into a real ingestion tool. A guided setup with no pipeline to maintain makes it the default answer for bulk and incremental loads.',
    {
      upside: ['Upsert to Warehouse and SQL database', 'More CDC sources'],
      downside: ['Connector coverage stalls behind pipelines'],
    },
  ),

  entry('pipeline', '2025-11-14', [6, 5, 5], 'stable', 'Initial rating.'),
  entry('pipeline', '2026-03-13', [6, 4, 5], 'negative', 'Monitoring hub regressions made failures harder to trace.'),
  entry(
    'pipeline',
    '2026-08-14',
    [6, 5, 5],
    'stable',
    'The orchestration workhorse, with the widest set of activities and connectors. The authoring canvas is dated, and debugging nested pipelines still takes too many clicks.',
    {
      upside: ['Better run comparison and debugging'],
      downside: ['Activity run cost increases', 'Monitoring regressions return'],
    },
  ),

  entry('spark-job-definition', '2025-12-12', [5, 3, 5], 'stable', 'Initial rating.'),
  entry(
    'spark-job-definition',
    '2026-07-17',
    [6, 3, 5],
    'stable',
    'Solid for packaged Spark workloads and CI/CD. Day-to-day experience is bare: logs are hard to find and there is no inline debugging.',
    {
      upside: ['First-class log and driver output view'],
      downside: ['Falls further behind notebooks on features'],
    },
  ),

  entry('dataflow-gen2', '2025-11-14', [5, 5, 2], 'stable', 'Initial rating. Capable, but the most expensive way to move rows.'),
  entry('dataflow-gen2', '2026-03-13', [5, 5, 3], 'positive', 'Fast copy now applies to more sources, cutting CU usage on large loads.'),
  entry(
    'dataflow-gen2',
    '2026-09-18',
    [6, 5, 4],
    'positive',
    'Power Query authoring with CI/CD, parameters, and a faster engine. Cost has improved two notches in a year but still trails Copy job and notebooks for large volumes.',
    {
      upside: ['Cost reaches parity with Copy job for simple loads'],
      downside: ['Pricing changes for the new engine'],
    },
  ),

  entry(
    'environment',
    '2026-01-16',
    [3, 3, 5],
    'stable',
    'Necessary but rough. Publishing custom libraries is slow, and failures give little detail about which dependency broke.',
    {
      upside: ['Publish times under two minutes', 'Clear dependency error messages'],
      downside: ['Publishing becomes a blocker for Git deployments'],
    },
  ),

  entry('airflow-job', '2026-02-13', [4, 3, 3], 'developing', 'Initial rating. Early preview with a small feature set.'),
  entry(
    'airflow-job',
    '2026-08-14',
    [4, 3, 3],
    'developing',
    'Managed Airflow inside Fabric is useful for teams already on DAGs. It is still in preview, and the always-on runtime makes it expensive for light schedules.',
    {
      upside: ['General availability', 'Autoscale to zero'],
      downside: ['Preview is extended with no roadmap'],
    },
  ),

  // Storage
  entry('lakehouse', '2025-11-14', [7, 6, 6], 'positive', 'Initial rating. The center of OneLake.'),
  entry('lakehouse', '2026-05-15', [7, 7, 6], 'positive', 'Schemas and shortcuts transformations remove most remaining friction.'),
  entry(
    'lakehouse',
    '2026-09-18',
    [7, 7, 7],
    'stable',
    'The foundation of Fabric. Delta storage, shortcuts, schemas, and automatic SQL endpoint make it the default home for data, and storage-only costs keep it the cheapest place to keep it.',
    {
      downside: ['Table maintenance becomes a manual cost again', 'Shortcut reliability issues'],
    },
  ),

  entry('warehouse', '2025-11-14', [5, 5, 5], 'stable', 'Initial rating.'),
  entry('warehouse', '2026-05-15', [6, 5, 6], 'positive', 'Query performance and burstable capacity improvements.'),
  entry(
    'warehouse',
    '2026-09-18',
    [6, 6, 6],
    'positive',
    'Full T-SQL writes over Delta, with strong performance and good concurrency. Missing pieces like some T-SQL surface area keep it a notch behind the Lakehouse.',
    {
      upside: ['Remaining T-SQL gaps closed', 'Faster cold queries'],
      downside: ['Concurrency throttling under bursty loads'],
    },
  ),

  entry('sql-database', '2025-11-14', [4, 5, 4], 'developing', 'Initial rating. Recently out of preview.'),
  entry('sql-database', '2026-03-13', [5, 5, 4], 'positive', 'Mirroring to OneLake is now reliable.'),
  entry(
    'sql-database',
    '2026-08-14',
    [5, 6, 4],
    'stable',
    'An operational database that lands in OneLake automatically. Setup is excellent; the cost of an always-on database on shared capacity holds the rating down.',
    {
      upside: ['Cheaper idle compute'],
      downside: ['Capacity spikes from background mirroring'],
    },
  ),

  entry('eventhouse', '2025-12-12', [6, 4, 5], 'stable', 'Initial rating.'),
  entry(
    'eventhouse',
    '2026-07-17',
    [6, 5, 5],
    'stable',
    'Excellent for logs and time series with very fast KQL. The experience is improving but still assumes you already know Kusto.',
    {
      upside: ['Always-on minimum compute becomes optional'],
      downside: ['OneLake availability lag'],
    },
  ),

  entry(
    'kql-database',
    '2026-02-13',
    [6, 5, 6],
    'stable',
    'Fast, compact, and well-priced for telemetry workloads. Ranks slightly above its parent Eventhouse because a single database is simpler to run.',
    {
      upside: ['Better schema tooling'],
      downside: ['Ingestion mapping errors stay hard to diagnose'],
    },
  ),

  entry('sql-analytics-endpoint', '2025-11-14', [4, 4, 6], 'negative', 'Initial rating. Metadata sync delays.'),
  entry(
    'sql-analytics-endpoint',
    '2026-02-13',
    [4, 2, 6],
    'negative',
    'Rated D after metadata sync stalls left tables stale for hours.',
    { flag: 'broken' },
  ),
  entry(
    'sql-analytics-endpoint',
    '2026-06-12',
    [4, 5, 6],
    'stable',
    'Sync stalls are fixed and a manual refresh is available. Read-only T-SQL over the Lakehouse with no extra copies is good value, though write support is still missing.',
    {
      upside: ['Sync becomes instant'],
      downside: ['Sync stalls return'],
    },
  ),

  entry('mirrored-database', '2025-11-14', [4, 5, 7], 'positive', 'Initial rating. Free replication compute.'),
  entry(
    'mirrored-database',
    '2026-05-15',
    [6, 5, 7],
    'positive',
    'Near real-time replicas of Azure SQL, Snowflake, Cosmos DB, and more, with replication compute and storage included. Source coverage is still growing.',
    {
      upside: ['More sources reach general availability'],
      downside: ['Free replication allowance shrinks'],
    },
  ),

  // Real-Time Intelligence
  entry('eventstream', '2025-11-14', [5, 5, 4], 'stable', 'Initial rating.'),
  entry(
    'eventstream',
    '2026-06-12',
    [6, 5, 4],
    'stable',
    'No-code streaming ingestion with useful transformations and many sources. Throughput units add up quickly at volume.',
    {
      upside: ['Cheaper throughput tiers'],
      downside: ['Throughput cost increases'],
    },
  ),

  entry(
    'kql-queryset',
    '2026-01-16',
    [4, 4, 4],
    'stable',
    'A good place to save and share KQL. It does its job, but it adds little over writing queries in the database itself.',
    {
      upside: ['Copilot that understands the schema'],
      downside: ['Overlap with notebooks makes it redundant'],
    },
  ),

  entry('activator', '2025-11-14', [3, 4, 5], 'developing', 'Initial rating.'),
  entry(
    'activator',
    '2026-06-12',
    [4, 4, 5],
    'positive',
    'No-code alerts on data and streams. The rule designer is approachable, but complex conditions and action types are still limited.',
    {
      upside: ['Richer actions and conditions'],
      downside: ['Missed or delayed alerts'],
    },
  ),

  entry('real-time-dashboard', '2026-01-16', [5, 5, 4], 'stable', 'Initial rating.'),
  entry(
    'real-time-dashboard',
    '2026-08-14',
    [4, 4, 3],
    'negative',
    'Fast visuals straight from KQL. Auto-refresh on large queries burns capacity, and the editing experience has fallen behind Power BI.',
    {
      upside: ['Query result caching'],
      downside: ['Continued capacity cost from auto-refresh'],
    },
  ),

  // Power BI
  entry('semantic-model', '2025-11-14', [7, 6, 5], 'positive', 'Initial rating.'),
  entry(
    'semantic-model',
    '2026-07-17',
    [7, 7, 6],
    'stable',
    'The most mature item in Fabric. Direct Lake, TMDL, and web modeling make it the strongest layer in the stack. Large Import models can still use a lot of capacity on refresh.',
    {
      upside: ['Direct Lake fallback eliminated'],
      downside: ['Refresh cost increases'],
    },
  ),

  entry(
    'report',
    '2026-03-13',
    [6, 6, 6],
    'stable',
    'Familiar and capable. PBIR format and Git support help, but advanced formatting still means a lot of clicking.',
    {
      upside: ['Full web authoring parity with Desktop'],
      downside: ['Visual performance regressions'],
    },
  ),

  entry(
    'paginated-report',
    '2025-12-12',
    [4, 3, 4],
    'stable',
    'Pixel-perfect output that works. The authoring tool is dated and web authoring is limited.',
    {
      upside: ['Full web authoring'],
      downside: ['Report Builder stops getting updates'],
    },
  ),

  entry('dashboard', '2025-11-14', [4, 4, 5], 'negative', 'Initial rating.'),
  entry(
    'dashboard',
    '2026-07-17',
    [3, 3, 5],
    'negative',
    'Still works, but it is not getting new features. Reports and Real-Time Dashboards cover almost every use case better.',
    {
      downside: ['Deprecation announcement'],
    },
  ),

  entry('dataflow-gen1', '2025-11-14', [3, 4, 3], 'negative', 'Initial rating.'),
  entry('dataflow-gen1', '2026-04-10', [3, 3, 2], 'negative', 'No new features; Gen2 is the clear path.'),
  entry(
    'dataflow-gen1',
    '2026-09-18',
    [2, 2, 1],
    'negative',
    'Superseded by Dataflow Gen2. No CI/CD, no Fabric destinations, and a higher cost per row than any alternative.',
    {
      downside: ['Retirement announcement moves it to E'],
    },
  ),

  entry('datamart', '2025-11-14', [3, 3, 3], 'negative', 'Initial rating.'),
  entry('datamart', '2026-03-13', [2, 2, 2], 'negative', 'Retirement announced, migrate to Warehouse.'),
  entry(
    'datamart',
    '2026-10-02',
    [1, 1, 1],
    'stable',
    'Withdrawn. Datamart is retired; move workloads to Warehouse or SQL database.',
    { flag: 'withdrawn' },
  ),

  // Data Science & AI
  entry(
    'ml-model',
    '2026-02-13',
    [5, 4, 6],
    'stable',
    'MLflow-backed model registry with batch scoring. Real-time endpoints are limited, and the UI is thin compared to dedicated ML platforms.',
    {
      upside: ['Managed real-time endpoints'],
      downside: ['Feature work slows'],
    },
  ),

  entry(
    'experiment',
    '2026-02-13',
    [4, 3, 5],
    'stable',
    'Good MLflow tracking at no extra cost. Comparing runs works, but the experience is basic.',
    {
      upside: ['Richer run comparison'],
      downside: ['MLflow version lags'],
    },
  ),

  entry('data-agent', '2025-12-12', [3, 3, 3], 'developing', 'Initial rating. Early preview.'),
  entry('data-agent', '2026-04-10', [4, 4, 3], 'positive', 'More data sources and better answer quality.'),
  entry(
    'data-agent',
    '2026-09-18',
    [5, 4, 3],
    'positive',
    'Conversational Q&A over Lakehouse, Warehouse, semantic models, and KQL. Answers are improving quickly, but token cost per question is high and tuning is trial and error.',
    {
      upside: ['Lower token cost', 'Evaluation tooling'],
      downside: ['Answer quality regressions'],
    },
  ),

  // Developer & Platform
  entry(
    'variable-library',
    '2026-03-13',
    [4, 5, 7],
    'positive',
    'Simple, free, and it solves environment-specific config for deployments. Supported item types are still limited.',
    {
      upside: ['Support across all item types'],
      downside: ['Adoption stalls'],
    },
  ),

  entry(
    'graphql-api',
    '2026-01-16',
    [4, 3, 4],
    'stable',
    'A quick GraphQL layer over Fabric data. Useful for simple apps; limited for complex mutations and authorization.',
    {
      upside: ['Field-level security'],
      downside: ['Performance at scale'],
    },
  ),

  entry('user-data-functions', '2026-01-16', [3, 4, 5], 'developing', 'Initial rating.'),
  entry(
    'user-data-functions',
    '2026-08-14',
    [4, 5, 5],
    'positive',
    'Python functions callable from pipelines, notebooks, and reports. Good developer loop; limited libraries and triggers.',
    {
      upside: ['More triggers and connections'],
      downside: ['Cold-start latency'],
    },
  ),
];
