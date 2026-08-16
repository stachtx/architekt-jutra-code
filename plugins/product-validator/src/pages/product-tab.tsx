import { useEffect, useState, useMemo } from "react";
import { getSDK } from "../../../sdk";
import { toValidationResult } from "../domain";
import type { ValidationResult } from "../domain";

function VerdictBadge({ verdict }: { verdict: string }) {
  const ok = verdict === "OK" || verdict === "FITS" || verdict === "WITHIN_NORM" || verdict === "PASS";
  const warn = verdict === "ISSUES" || verdict === "UNCERTAIN" || verdict === "REVIEW";
  const className = ok
    ? "tc-badge tc-badge--success"
    : warn
    ? "tc-badge tc-badge--warning"
    : "tc-badge tc-badge--danger";
  return <span className={className}>{verdict}</span>;
}

export default function ProductTab() {
  const sdk = useMemo(() => (typeof window !== "undefined" ? getSDK() : null), []);
  const productId = sdk?.thisPlugin.productId ?? "";

  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  useEffect(() => {
    if (!sdk) return;
    if (!productId) {
      setError("Product ID is missing. This tab must be opened from a product detail page.");
      setLoading(false);
      return;
    }

    async function load() {
      try {
        const token = await sdk!.hostApp.getToken();
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split(".")[1]));
            const permissions = (payload.permissions ?? []) as string[];
            setCanEdit(permissions.includes("EDIT"));
          } catch { /* invalid token — leave canEdit false */ }
        }

        const objects = await sdk!.thisPlugin.objects.listByEntity("PRODUCT", productId);
        if (objects.length > 0) {
          setResult(toValidationResult(objects[0]));
        }
      } catch {
        setError("Failed to load existing validation.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [productId, sdk]);

  async function handleValidate() {
    if (!sdk) return;
    setError(null);
    setValidating(true);

    try {
      const token = await sdk.hostApp.getToken();
      const response = await fetch("/api/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ productId }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Validation failed.");
      }

      const data = (await response.json()) as ValidationResult;
      setResult({ ...data, objectId: productId });
    } catch (err) {
      if (err instanceof TypeError && err.message === "Failed to fetch") {
        setError("Network error. Please check your connection and try again.");
      } else {
        setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      }
    } finally {
      setValidating(false);
    }
  }

  if (loading) {
    return <div className="tc-plugin" style={{ padding: "1rem" }}>Loading...</div>;
  }

  return (
    <div className="tc-plugin" style={{ padding: "1.5rem" }}>
      <h3 style={{ margin: "0 0 1rem" }}>AI Validation</h3>

      {error && <p className="tc-error">{error}</p>}

      {result && (
        <>
          <div className="tc-card" style={{ padding: "1rem", marginBottom: "1rem" }}>
            <h4 style={{ margin: "0 0 0.5rem" }}>
              Description &nbsp;<VerdictBadge verdict={result.descriptionVerdict} />
              &nbsp;<span style={{ fontSize: "13px", color: "#555" }}>Score: {result.descriptionScore}/5</span>
            </h4>
            {result.descriptionIssues.length > 0 && (
              <>
                <p style={{ margin: "0.5rem 0 0.25rem", fontSize: "13px", fontWeight: 500 }}>Issues</p>
                <ul style={{ margin: "0 0 0.5rem", paddingLeft: "1.25rem", fontSize: "13px" }}>
                  {result.descriptionIssues.map((issue, i) => <li key={i}>{issue}</li>)}
                </ul>
              </>
            )}
            {result.descriptionSuggestions.length > 0 && (
              <>
                <p style={{ margin: "0.5rem 0 0.25rem", fontSize: "13px", fontWeight: 500 }}>Suggestions</p>
                <ul style={{ margin: "0", paddingLeft: "1.25rem", fontSize: "13px" }}>
                  {result.descriptionSuggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </>
            )}
          </div>

          <div className="tc-card" style={{ padding: "1rem", marginBottom: "1rem" }}>
            <h4 style={{ margin: "0 0 0.5rem" }}>
              Category &nbsp;<VerdictBadge verdict={result.categoryVerdict} />
            </h4>
            <p style={{ margin: "0 0 0.5rem", fontSize: "13px" }}>{result.categoryReasoning}</p>
            {result.suggestedCategories.length > 0 && (
              <p style={{ margin: "0", fontSize: "13px" }}>
                <strong>Suggested:</strong> {result.suggestedCategories.join(", ")}
              </p>
            )}
          </div>

          <div className="tc-card" style={{ padding: "1rem", marginBottom: "1rem" }}>
            <h4 style={{ margin: "0 0 0.5rem" }}>
              Price &nbsp;<VerdictBadge verdict={result.priceVerdict} />
            </h4>
            {result.priceVerdict !== "INSUFFICIENT_DATA" && (
              <p style={{ margin: "0 0 0.5rem", fontSize: "13px" }}>
                Market range: {result.priceMarketLow} – {result.priceMarketHigh}
              </p>
            )}
            <p style={{ margin: "0", fontSize: "13px" }}>{result.priceReasoning}</p>
          </div>

          <div className="tc-card" style={{ padding: "1rem", marginBottom: "1rem" }}>
            <h4 style={{ margin: "0 0 0.5rem" }}>
              Overall &nbsp;<VerdictBadge verdict={result.overallVerdict} />
            </h4>
            <p style={{ margin: "0", fontSize: "13px" }}>{result.summary}</p>
          </div>
        </>
      )}

      {canEdit && (
        <button
          className="tc-primary-button"
          onClick={() => void handleValidate()}
          disabled={validating}
        >
          {validating ? "Validating..." : result ? "Re-run validation" : "Run validation"}
        </button>
      )}
    </div>
  );
}
