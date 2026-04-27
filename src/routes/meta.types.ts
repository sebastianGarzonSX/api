// Tipos de respuesta del endpoint GET /api/meta/campaigns

export interface MetaCampaignRow {
  id:              string
  campaign_id:     string
  campaign_name:   string
  date_start:      string
  date_stop:       string
  impressions:     number
  clicks:          number
  spend:           number
  reach:           number
  ctr:             number
  cpm:             number
  conversions:     number
  cost_per_result: number
  synced_at:       string
}

export interface MetaCampaignSummary {
  campaign_id:     string
  campaign_name:   string
  total_impressions: number
  total_clicks:    number
  total_spend:     number
  total_reach:     number
  avg_ctr:         number
  avg_cpm:         number
  total_conversions: number
  avg_cost_per_result: number
}

export interface MetaCampaignsResponse {
  data:      MetaCampaignRow[]
  summary:   MetaCampaignSummary[]
  since:     string
  until:     string
  total:     number
}
