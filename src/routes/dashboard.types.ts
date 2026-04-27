import type { LeadStage } from '../types/index.js'

export interface StageCount  { stage: LeadStage; count: number }
export interface SourceCount { source: string;   count: number }

export interface DashboardKPIs {
  leads: {
    total:        number
    this_month:   number
    prev_month:   number
    by_stage:     StageCount[]
    by_source:    SourceCount[]
  }
  opportunities: {
    total_open:              number
    total_won:               number
    total_lost:              number
    value_open:              number
    value_won:               number
    value_won_prev_month:    number
    conversion_rate:         number
  }
  last_synced_at: string
}
