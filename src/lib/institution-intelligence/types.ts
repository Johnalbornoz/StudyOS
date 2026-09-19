/**
 * F12 -- shared Institution Intelligence types. `MetricEnvelope` is the
 * one reusable shape every institutional metric returns through
 * (task section 10: metric_id, name, scope, time window, population,
 * numerator/denominator, exclusions, data source, policy version,
 * calculated_at, limitations) -- no institutional metric in this module
 * is ever returned as a bare number.
 */

export type AnalyticsScopeType = 'INSTITUTION' | 'GRADE' | 'CLASS';

export interface AnalyticsScope {
  type: AnalyticsScopeType;
  id: string;
}

export interface TimeWindow {
  /** LIFETIME = no time bound (all historical rows); ROLLING_DAYS = activity within the last N days from `asOf`. Never silently mixed (task section 29). */
  type: 'LIFETIME' | 'ROLLING_DAYS';
  days?: number;
  asOf: string;
}

export interface MetricEnvelope<T> {
  metricId: string;
  name: string;
  scope: AnalyticsScope;
  timeWindow: TimeWindow;
  population: { description: string; count: number };
  numerator: number | null;
  denominator: number | null;
  exclusions: string[];
  dataSource: string;
  policyVersion: number | null;
  calculatedAt: string;
  limitations: string[];
  value: T;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function buildMetric<T>(params: {
  metricId: string;
  name: string;
  scope: AnalyticsScope;
  timeWindow: TimeWindow;
  populationDescription: string;
  populationCount: number;
  numerator?: number | null;
  denominator?: number | null;
  exclusions?: string[];
  dataSource: string;
  policyVersion?: number | null;
  limitations?: string[];
  value: T;
}): MetricEnvelope<T> {
  return {
    metricId: params.metricId,
    name: params.name,
    scope: params.scope,
    timeWindow: params.timeWindow,
    population: { description: params.populationDescription, count: params.populationCount },
    numerator: params.numerator ?? null,
    denominator: params.denominator ?? null,
    exclusions: params.exclusions ?? [],
    dataSource: params.dataSource,
    policyVersion: params.policyVersion ?? null,
    calculatedAt: nowIso(),
    limitations: params.limitations ?? [],
    value: params.value,
  };
}

export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  items: T[];
  limit: number;
  offset: number;
  totalCount: number;
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export function clampPagination(params?: Partial<PaginationParams>): PaginationParams {
  const limit = Math.min(Math.max(params?.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = Math.max(params?.offset ?? 0, 0);
  return { limit, offset };
}
