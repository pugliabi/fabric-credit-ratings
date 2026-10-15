import type { Workload } from '../domain/types.ts';

export const WORKLOADS: readonly Workload[] = [
  {
    id: 'data-engineering',
    name: 'Data Engineering',
    shortName: 'Data Eng',
    blurb: 'Notebooks, Spark, pipelines, and data movement',
  },
  {
    id: 'storage',
    name: 'Storage & Databases',
    shortName: 'Storage',
    blurb: 'Lakehouses, warehouses, and databases',
  },
  {
    id: 'mirroring',
    name: 'Mirroring',
    shortName: 'Mirroring',
    blurb: 'Near real-time replicas of external databases in OneLake',
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
    id: 'fabric-iq',
    name: 'Fabric IQ',
    shortName: 'Fabric IQ',
    blurb: 'Ontology, graph, agents, and planning',
  },
  {
    id: 'onelake',
    name: 'OneLake',
    shortName: 'OneLake',
    blurb: 'Catalog, shortcuts, security, and open table formats',
  },
  {
    id: 'data-science-ai',
    name: 'Data Science & AI',
    shortName: 'Data Science',
    blurb: 'Models, experiments, Copilot, and AI functions',
  },
  {
    id: 'cicd',
    name: 'Developer Controls (CI/CD)',
    shortName: 'CI/CD',
    blurb: 'Git, deployment, and automation tooling',
  },
  {
    id: 'mcp',
    name: 'MCP Servers',
    shortName: 'MCP',
    blurb: 'Model Context Protocol servers for agents and IDEs',
  },
  {
    id: 'developer-platform',
    name: 'Developer & Platform',
    shortName: 'Developer',
    blurb: 'APIs, functions, monitoring, and extensibility',
  },
  {
    id: 'governance',
    name: 'Governance & Security',
    shortName: 'Governance',
    blurb: 'Purview, domains, lineage, and access control',
  },
];
