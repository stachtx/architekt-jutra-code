import type { PluginObject } from "../../sdk";

export interface ValidationResult {
  objectId: string;
  descriptionVerdict: string;
  descriptionScore: number;
  descriptionIssues: string[];
  descriptionSuggestions: string[];
  categoryVerdict: string;
  categoryReasoning: string;
  suggestedCategories: string[];
  priceVerdict: string;
  priceMarketLow: number;
  priceMarketHigh: number;
  priceReasoning: string;
  overallVerdict: string;
  summary: string;
}

export function toValidationResult(obj: PluginObject): ValidationResult {
  return {
    objectId: obj.objectId,
    descriptionVerdict: obj.data.descriptionVerdict as string,
    descriptionScore: obj.data.descriptionScore as number,
    descriptionIssues: (obj.data.descriptionIssues as string[]) ?? [],
    descriptionSuggestions: (obj.data.descriptionSuggestions as string[]) ?? [],
    categoryVerdict: obj.data.categoryVerdict as string,
    categoryReasoning: obj.data.categoryReasoning as string,
    suggestedCategories: (obj.data.suggestedCategories as string[]) ?? [],
    priceVerdict: obj.data.priceVerdict as string,
    priceMarketLow: obj.data.priceMarketLow as number,
    priceMarketHigh: obj.data.priceMarketHigh as number,
    priceReasoning: obj.data.priceReasoning as string,
    overallVerdict: obj.data.overallVerdict as string,
    summary: obj.data.summary as string,
  };
}
