export type { ApiError, Opportunity, OpportunityStatus } from '../types/index.js'

export interface PipelineStage {
  stage_name:   string
  count:        number
  total_value:  number
  percentage:   number
}
