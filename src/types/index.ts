// =============================================================================
// TIPOS COMPARTIDOS — Backend API
// Deben mantenerse sincronizados con front/types/index.ts
// =============================================================================

export type Role = 'admin' | 'analista' | 'viewer'

export type LeadStage =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal'
  | 'negotiation'
  | 'won'
  | 'lost'

export type OpportunityStatus = 'open' | 'won' | 'lost'

export interface Lead {
  id:             string
  ghl_contact_id: string
  name:           string
  email:          string | null
  phone:          string | null
  source:         string | null
  stage:          LeadStage
  created_at:     string
  updated_at:     string
}

export interface Opportunity {
  id:                  string
  ghl_opportunity_id:  string
  lead_id:             string
  pipeline_id:         string
  stage_name:          string
  value:               number
  status:              OpportunityStatus
  created_at:          string
}

export interface UserProfile {
  id:   string
  name: string
  role: Role
}

// Forma que adjuntamos al Request tras verificar el JWT
export interface AuthenticatedUser {
  id:    string
  email: string
  role:  Role
}

// Respuesta de error estándar — igual que ApiError en el front
export interface ApiError {
  error:   string
  code?:   string
  status:  number
}

// ── GHL API ──────────────────────────────────────────────────────────────────

export interface GHLAttribution {
  isFirst?:          boolean
  isLast?:           boolean
  adName?:           string   // Nombre del anuncio de Meta
  utmAdId?:          string   // ID del anuncio en Meta (para join con Meta Ads)
  utmSessionSource?: string   // Ej: 'Paid Social', 'organic'
  medium?:           string   // Ej: 'whatsapp', 'instagram'
  pageUrl?:          string
  url?:              string
}

export interface GHLCustomFieldValue {
  id:          string   // UUID del custom field en GHL
  fieldValue?: string | string[] | null
  value?:      string | string[] | null  // GHL API v2 returns "value" instead of "fieldValue"
}

export interface GHLContact {
  id:              string
  firstName?:      string
  lastName?:       string
  contactName?:    string
  email:           string | null
  phone:           string | null
  source:          string | null
  tags:            string[]
  dateAdded?:      string
  dateUpdated?:    string
  attributions?:   GHLAttribution[]
  customFields?:   GHLCustomFieldValue[]
}

export interface GHLCustomFieldDefinition {
  id:        string
  name:      string
  fieldKey?: string
  dataType?: string
}

export interface GHLCustomFieldDefinitionsResponse {
  customFields: GHLCustomFieldDefinition[]
}

export interface GHLContactsResponse {
  contacts: GHLContact[]
  meta: {
    total:         number
    nextPageUrl:   string | null
    startAfter:    number | null
    startAfterId:  string | null
  }
}

export interface GHLOpportunity {
  id:             string
  name:           string
  status:         'open' | 'won' | 'lost' | 'abandoned'
  monetaryValue:  number
  pipelineId:     string
  pipelineStageId: string
  pipelineStage?: { id: string; name: string }
  contact?:       { id: string; name: string }
  createdAt?:     string
}

export interface GHLOpportunitiesResponse {
  opportunities: GHLOpportunity[]
  meta: {
    total:       number
    nextPageUrl: string | null
    currentPage: number
    nextPage:    number | null
    prevPage:    number | null
  }
}

export interface GHLPipelineStage {
  id:                 string
  name:               string
  position:           number
  stageWinProbability?: number
}

export interface GHLPipeline {
  id:         string
  name:       string
  locationId: string
  stages:     GHLPipelineStage[]
}

export interface GHLPipelinesResponse {
  pipelines: GHLPipeline[]
}
