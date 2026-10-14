import type { Workload } from '../domain/types';

export const WORKLOADS: readonly Workload[] = [
  {
    id: 'data-engineering',
    name: 'Data Engineering',
    shortName: 'Data Eng',
    blurb: 'Notebooks, Spark, pipelines, and data movement',
  },
  {
    id: 'storage',
    name: 'Storage',
    shortName: 'Storage',
    blurb: 'Lakehouses, warehouses, and databases',
  },
  {
    id: 'real-time',
    name: 'Real-Time Intelligence',
    shortName: 'Real-Time',
    blurb: 'Streaming ingestion, KQL, and alerts',
  },
  {
    id: 'power-bi',
    name: 'Power BI',
    shortName: 'Power BI',
    blurb: 'Semantic models, reports, and dashboards',
  },
  {
    id: 'data-science-ai',
    name: 'Data Science & AI',
    shortName: 'Data Science',
    blurb: 'Models, experiments, and agents',
  },
  {
    id: 'developer-platform',
    name: 'Developer & Platform',
    shortName: 'Developer',
    blurb: 'APIs, functions, and configuration',
  },
];
