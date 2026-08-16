class ProductValidation {
  descriptionVerdict       string
  descriptionScore         int
  descriptionIssues        string[]
  descriptionSuggestions   string[]

  categoryVerdict          string
  categoryReasoning        string
  suggestedCategories      string[]

  priceVerdict             string
  priceMarketLow           float
  priceMarketHigh          float
  priceReasoning           string

  overallVerdict           string
  summary                  string
}

function ValidateProduct(
  productName: string,
  productDescription: string,
  productCategory: string,
  productPrice: float
) -> ProductValidation {
  client LlmProvider
  prompt #"
    You are a product quality auditor for an e-commerce catalog.
    Evaluate the product across three dimensions.

    Product:
    - Name: {{ productName }}
    - Description: {{ productDescription }}
    - Assigned Category: {{ productCategory }}
    - Price: {{ productPrice }}

    Dimension 1 — Description correctness:
    Score the description 1..5 (5 = excellent). List concrete issues (grammar, missing key info,
    inconsistency with the name) and actionable suggestions.
    descriptionVerdict values: "OK" (score >= 4), "ISSUES" (score 2-3), "INSUFFICIENT" (score 1).

    Dimension 2 — Category fit:
    Does the assigned category match the product? If not, suggest 1-3 better alternatives.
    categoryVerdict values: "FITS", "MISMATCH", "UNCERTAIN".

    Dimension 3 — Price vs market norm:
    Estimate a realistic market price range (low/high) and assess whether the given price is within,
    below, or above that norm. Use INSUFFICIENT_DATA if you cannot estimate reliably.
    priceVerdict values: "WITHIN_NORM", "BELOW_NORM", "ABOVE_NORM", "INSUFFICIENT_DATA".

    Overall verdict:
    "PASS" — all three dimensions are fine.
    "REVIEW" — at least one dimension has minor issues.
    "FAIL" — description is INSUFFICIENT or category is MISMATCH.

    {{ ctx.output_format }}
  "#
}
