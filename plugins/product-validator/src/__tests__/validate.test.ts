import { createMocks } from "node-mocks-http";
import type { NextApiRequest, NextApiResponse } from "next";

const mockValidateProduct = jest.fn();

jest.mock("../../baml_client", () => ({
  b: {
    ValidateProduct: (...args: unknown[]) => mockValidateProduct(...args),
  },
}));

const mockGetProduct = jest.fn();
const mockObjectsSave = jest.fn();

jest.mock("../../../server-sdk", () => ({
  createServerSDK: () => ({
    hostApp: {
      getProduct: (...args: unknown[]) => mockGetProduct(...args),
    },
    thisPlugin: {
      objects: {
        save: (...args: unknown[]) => mockObjectsSave(...args),
      },
    },
  }),
}));

import handler from "../pages/api/validate";

const sampleProduct = {
  name: "Laptop Pro",
  description: "A powerful laptop for professionals",
  price: 1499.99,
  category: { name: "Electronics" },
};

const sampleValidation = {
  descriptionVerdict: "OK",
  descriptionScore: 4,
  descriptionIssues: [],
  descriptionSuggestions: ["Add battery life info"],
  categoryVerdict: "FITS",
  categoryReasoning: "Electronics is a good match",
  suggestedCategories: [],
  priceVerdict: "WITHIN_NORM",
  priceMarketLow: 1200,
  priceMarketHigh: 1800,
  priceReasoning: "Typical mid-range laptop price",
  overallVerdict: "PASS",
  summary: "Product is well described and appropriately priced",
};

describe("POST /api/validate", () => {
  beforeEach(() => {
    mockValidateProduct.mockReset();
    mockGetProduct.mockReset();
    mockObjectsSave.mockReset();
  });

  test("rejects_missingProductId_returns400WithDetails", async () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: {},
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(400);
    const body = JSON.parse(res._getData());
    expect(body.error).toBe("Missing required fields");
    expect(body.details).toContain("productId");
  });

  test("accepts_validRequest_callsBamlWithProductFields", async () => {
    mockGetProduct.mockResolvedValue(sampleProduct);
    mockValidateProduct.mockResolvedValue(sampleValidation);
    mockObjectsSave.mockResolvedValue({});

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { productId: "5" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(mockGetProduct).toHaveBeenCalledWith("5");
    expect(mockValidateProduct).toHaveBeenCalledWith(
      "Laptop Pro",
      "A powerful laptop for professionals",
      "Electronics",
      1499.99
    );
  });

  test("validate_successfulCall_returns200AndSavesValidation", async () => {
    mockGetProduct.mockResolvedValue(sampleProduct);
    mockValidateProduct.mockResolvedValue(sampleValidation);
    mockObjectsSave.mockResolvedValue({});

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { productId: "42" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.overallVerdict).toBe("PASS");
    expect(body.descriptionScore).toBe(4);

    expect(mockObjectsSave).toHaveBeenCalledWith(
      "validation",
      "42",
      expect.objectContaining({ overallVerdict: "PASS" }),
      { entityType: "PRODUCT", entityId: "42" }
    );
  });

  test("validate_bamlFailure_returns500WithError", async () => {
    mockGetProduct.mockResolvedValue(sampleProduct);
    mockValidateProduct.mockRejectedValue(new Error("LLM provider timeout"));

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { productId: "42" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(500);
    const body = JSON.parse(res._getData());
    expect(body.error).toBeDefined();
  });

  test("validate_productFetchFails_propagatesStatus", async () => {
    mockGetProduct.mockRejectedValue(new Error("Host API error 404"));

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { productId: "999" },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(404);
  });

  test("validate_productWithNullCategory_passesNonePlaceholder", async () => {
    mockGetProduct.mockResolvedValue({ ...sampleProduct, category: null });
    mockValidateProduct.mockResolvedValue(sampleValidation);
    mockObjectsSave.mockResolvedValue({});

    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: "POST",
      body: { productId: "7" },
    });

    await handler(req, res);

    expect(mockValidateProduct).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "(none)",
      expect.any(Number)
    );
  });
});
