import type { Artifact } from '../domain/types';

export const ARTIFACTS: readonly Artifact[] = [
  { id: 'notebook', name: 'Notebook', workload: 'data-engineering', status: 'ga' },
  { id: 'copy-job', name: 'Copy job', workload: 'data-engineering', status: 'ga' },
  { id: 'pipeline', name: 'Pipeline', workload: 'data-engineering', status: 'ga' },
  { id: 'spark-job-definition', name: 'Spark job definition', workload: 'data-engineering', status: 'ga' },
  { id: 'dataflow-gen2', name: 'Dataflow Gen2', workload: 'data-engineering', status: 'ga' },
  { id: 'environment', name: 'Environment', workload: 'data-engineering', status: 'ga' },
  { id: 'airflow-job', name: 'Apache Airflow job', workload: 'data-engineering', status: 'preview' },

  { id: 'lakehouse', name: 'Lakehouse', workload: 'storage', status: 'ga' },
  { id: 'warehouse', name: 'Warehouse', workload: 'storage', status: 'ga' },
  { id: 'sql-database', name: 'SQL database', workload: 'storage', status: 'ga' },
  { id: 'eventhouse', name: 'Eventhouse', workload: 'storage', status: 'ga' },
  { id: 'kql-database', name: 'KQL database', workload: 'storage', status: 'ga' },
  { id: 'sql-analytics-endpoint', name: 'SQL analytics endpoint', workload: 'storage', status: 'ga' },
  { id: 'mirrored-database', name: 'Mirrored database', workload: 'storage', status: 'ga' },

  { id: 'eventstream', name: 'Eventstream', workload: 'real-time', status: 'ga' },
  { id: 'kql-queryset', name: 'KQL queryset', workload: 'real-time', status: 'ga' },
  { id: 'activator', name: 'Activator', workload: 'real-time', status: 'ga' },
  { id: 'real-time-dashboard', name: 'Real-Time Dashboard', workload: 'real-time', status: 'ga' },

  { id: 'semantic-model', name: 'Semantic model', workload: 'power-bi', status: 'ga' },
  { id: 'report', name: 'Report', workload: 'power-bi', status: 'ga' },
  { id: 'paginated-report', name: 'Paginated report', workload: 'power-bi', status: 'ga' },
  { id: 'dashboard', name: 'Dashboard', workload: 'power-bi', status: 'ga' },
  { id: 'dataflow-gen1', name: 'Dataflow Gen1', workload: 'power-bi', status: 'ga' },
  { id: 'datamart', name: 'Datamart', workload: 'power-bi', status: 'retired' },

  { id: 'ml-model', name: 'ML model', workload: 'data-science-ai', status: 'ga' },
  { id: 'experiment', name: 'Experiment', workload: 'data-science-ai', status: 'ga' },
  { id: 'data-agent', name: 'Data agent', workload: 'data-science-ai', status: 'preview' },

  { id: 'variable-library', name: 'Variable library', workload: 'developer-platform', status: 'ga' },
  { id: 'graphql-api', name: 'API for GraphQL', workload: 'developer-platform', status: 'ga' },
  { id: 'user-data-functions', name: 'User data functions', workload: 'developer-platform', status: 'ga' },
];
