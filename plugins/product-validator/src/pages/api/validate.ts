import type { NextApiRequest, NextApiResponse } from "next";
import { b } from "../../../baml_client";
import { createServerSDK } from "../../../../server-sdk";

interface ValidateRequest {
  productId: string | number;
}

interface ErrorResponse {
  error: string;
  details?: string[];
}

interface ValidateResponse {
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ValidateResponse | ErrorResponse>
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body as Partial<ValidateRequest>;

  const productId = body.productId != null ? String(body.productId).trim() : "";
  if (!productId) {
    return res.status(400).json({
      error: "Missing required fields",
      details: ["productId"],
    });
  }

  const sdk = createServerSDK("product-validator", undefined, req);

  try {
    const product = (await sdk.hostApp.getProduct(productId)) as {
      name: string;
      description: string;
      price: number | string;
      category?: { name?: string } | null;
    };

    const price = Number(product.price);
    if (isNaN(price)) {
      return res.status(400).json({ error: "Product price is not a valid number." });
    }

    const result = await b.ValidateProduct(
      product.name,
      product.description,
      product.category?.name ?? "(none)",
      price
    );

    const dataToSave: ValidateResponse = {
      descriptionVerdict: result.descriptionVerdict,
      descriptionScore: result.descriptionScore,
      descriptionIssues: result.descriptionIssues,
      descriptionSuggestions: result.descriptionSuggestions,
      categoryVerdict: result.categoryVerdict,
      categoryReasoning: result.categoryReasoning,
      suggestedCategories: result.suggestedCategories,
      priceVerdict: result.priceVerdict,
      priceMarketLow: result.priceMarketLow,
      priceMarketHigh: result.priceMarketHigh,
      priceReasoning: result.priceReasoning,
      overallVerdict: result.overallVerdict,
      summary: result.summary,
    };

    await sdk.thisPlugin.objects.save("validation", productId, dataToSave, {
      entityType: "PRODUCT",
      entityId: productId,
    });

    return res.status(200).json(dataToSave);
  } catch (err) {
    console.error("Validate failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    const statusMatch = message.match(/Host API error (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 500;
    return res.status(status).json({ error: message });
  }
}
