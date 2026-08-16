import { toValidationResult } from "../domain";
import type { PluginObject } from "../../../sdk";

const sampleObject: PluginObject = {
  id: "1",
  pluginId: "product-validator",
  objectType: "validation",
  objectId: "42",
  data: {
    descriptionVerdict: "OK",
    descriptionScore: 4,
    descriptionIssues: [],
    descriptionSuggestions: ["Add more keywords"],
    categoryVerdict: "FITS",
    categoryReasoning: "Matches well",
    suggestedCategories: [],
    priceVerdict: "WITHIN_NORM",
    priceMarketLow: 100,
    priceMarketHigh: 200,
    priceReasoning: "Within expected range",
    overallVerdict: "PASS",
    summary: "Product looks good",
  },
};

describe("toValidationResult", () => {
  test("maps_allFields_correctly", () => {
    const result = toValidationResult(sampleObject);

    expect(result.objectId).toBe("42");
    expect(result.descriptionVerdict).toBe("OK");
    expect(result.descriptionScore).toBe(4);
    expect(result.descriptionIssues).toEqual([]);
    expect(result.descriptionSuggestions).toEqual(["Add more keywords"]);
    expect(result.categoryVerdict).toBe("FITS");
    expect(result.categoryReasoning).toBe("Matches well");
    expect(result.suggestedCategories).toEqual([]);
    expect(result.priceVerdict).toBe("WITHIN_NORM");
    expect(result.priceMarketLow).toBe(100);
    expect(result.priceMarketHigh).toBe(200);
    expect(result.priceReasoning).toBe("Within expected range");
    expect(result.overallVerdict).toBe("PASS");
    expect(result.summary).toBe("Product looks good");
  });

  test("defaults_arrays_to_empty_when_missing", () => {
    const obj: PluginObject = {
      ...sampleObject,
      data: {
        ...sampleObject.data,
        descriptionIssues: undefined,
        descriptionSuggestions: undefined,
        suggestedCategories: undefined,
      },
    };

    const result = toValidationResult(obj);

    expect(result.descriptionIssues).toEqual([]);
    expect(result.descriptionSuggestions).toEqual([]);
    expect(result.suggestedCategories).toEqual([]);
  });
});
