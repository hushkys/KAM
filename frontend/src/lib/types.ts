// Shapes of the API responses the screens read.

export interface SeriesPoint { year: number; value: number }
export interface Trend {
  kind: "trend" | "vykyv" | "stabilni" | "malo_dat"; label: string; direction?: string; judgement?: "zlepseni" | "zhorseni" | "neutralni";
  slope?: number; pct_per_year?: number; p_value?: number; since?: number | null; outliers?: { year: number; value: number; z: number }[]; points?: number;
}
export interface IndicatorCard {
  code: string; name: string; unit: string; pillar: string; polarity: number; derived: boolean; formula?: string; inputs?: string[];
  source?: string; origin?: string; source_url?: string; year: number; value: number; series: SeriesPoint[]; trend: Trend;
  compare: { ref: string; value: number; ratio: number | null; verdict: "lepsi" | "horsi" | "srovnatelne" } | null; text: string; freshness: string;
}
export interface Evidence { code: string; name: string; unit: string; year: number; value: number; from: number; to: number; source: string; url: string; formula: string }
export interface Risk {
  id: string; type: string; title: string; pillar: string; score: number; level: string; level_label: string; kind: string; text: string; why: string[];
  evidence: Evidence[]; period: string; confidence: number; interventions: string[]; trend: Trend | null;
}
export interface Milestone { year: number; population: number; lower: number; upper: number; optimistic: number | null; risk: number | null; share_65: number | null; change_pct: number }
export interface Outlook { base_year?: number; base_population?: number; milestones?: Milestone[]; available?: boolean; reason?: string }
export interface Profile {
  territory: { id: string; level: string; code: string; name: string; parent: { id: string; name: string } | null; okres: string | null; population: number | null; population_year: number | null; area_km2: number | null };
  reference: { id: string; name: string | null };
  pillars: { key: string; label: string; status: string; status_label: string; cards: IndicatorCard[] }[];
  facts: Record<string, { value: string; source_url: string; as_of: string }>;
  sources: { label: string; origin: string; url: string }[];
  risks: Risk[]; outlook: Outlook; pois?: { kind: string; label: string; count: number }[];
}
export interface ForecastRow { year: number; population: number; lower: number; upper: number; age_65: number | null; age_0_14: number | null; share_65: number | null; share_0_14: number | null; births: number; deaths: number; migration: number }
export interface Forecast {
  available: boolean; reason?: string; territory: string; base_year: number; base_population: number;
  history: { year: number; population: number; age_65: number | null; age_0_14: number | null }[];
  scenarios: Record<"pravdepodobny" | "optimisticky" | "rizikovy", ForecastRow[]>;
  paths?: { year: number; population: number }[][];
  assumptions: string[]; method: string; sd_growth: number; shrink_weight: number;
  backtest: { available: boolean; cutoff?: number; mape?: number; max_error?: number; coverage?: number; points?: { year: number; actual: number; predicted: number; lower: number; upper: number }[] };
}
export interface Overview {
  kraj: { id: string; name: string };
  kpis: { key: string; label: string; value: number; year: number; unit: string; change: number | null; since: number | null; series: SeriesPoint[] }[];
  outlook: Outlook;
  datasets: { total: number; verified: number; broken: number; no_link: number; core: number; kraje: number; other: number; loaded: number; api_sources: number; publishers: number };
  model: { observations: number; years: [number, number]; territories: number; pois: number; indicators: number };
  risks: { territory: { id: string; name: string; population: number }; top: { type: string; title: string; level: string; level_label: string; score: number; text: string }; count: number; score: number }[];
  kraj_risks: Risk[];
}
export interface SourceRow { id: string; name: string; group: string; portal_url: string; url: string; kind: string; harvested_at: string | null; datasets: number; verified: number }
export interface Sources { total: number; verified: number; broken: number; no_link: number; unchecked: number; core: number; kraje: number; other: number; publishers: number; loaded: number; api_sources: number; sources: SourceRow[]; by_pillar: { key: string; label: string; count: number }[]; by_region: Record<string, number>; by_freshness: Record<string, number> }
export interface IndicatorMeta { code: string; name: string; unit: string; pillar: string; polarity: number; derived: boolean; formula?: string }
