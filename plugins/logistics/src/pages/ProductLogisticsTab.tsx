import { useEffect, useState } from "react";
import { getSDK } from "../../../sdk";
import { toCourier, toDeliveryMethod, toProductLogistics, isMethodEnabled } from "../domain";
import type { Courier, DeliveryMethod } from "../domain";

export function ProductLogisticsTab() {
  const [methods, setMethods] = useState<DeliveryMethod[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sdk = getSDK();
  const productId = sdk.thisPlugin.productId ?? "";

  useEffect(() => {
    if (!productId) { setLoading(false); return; }

    async function load() {
      try {
        const [methodObjects, courierObjects, logisticsObj] = await Promise.all([
          sdk.thisPlugin.objects.list("delivery_method"),
          sdk.thisPlugin.objects.list("courier"),
          sdk.thisPlugin.objects.get("product_logistics", productId).catch(() => null),
        ]);
        const loadedMethods = methodObjects.map(toDeliveryMethod);
        const loadedLogistics = logisticsObj ? toProductLogistics(logisticsObj) : null;
        setMethods(loadedMethods);
        setCouriers(courierObjects.map(toCourier));
        const initial: Record<string, boolean> = {};
        for (const m of loadedMethods) {
          initial[m.objectId] = isMethodEnabled(loadedLogistics, m.objectId);
        }
        setChecked(initial);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load delivery options");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [productId]);

  async function handleSave() {
    setSaving(true);
    setSavedOk(false);
    setError(null);
    try {
      const disabledMethodIds = methods.filter((m) => !checked[m.objectId]).map((m) => m.objectId);
      await sdk.thisPlugin.objects.save(
        "product_logistics",
        productId,
        { disabledMethodIds },
        { entityType: "PRODUCT", entityId: productId },
      );
      setSavedOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (!productId) return <p>No product context available.</p>;
  if (loading) return <p>Loading delivery options...</p>;

  if (methods.length === 0) {
    return (
      <div className="tc-plugin" style={{ padding: "1rem" }}>
        <h2>Delivery Options</h2>
        <p>No delivery methods configured. Set them up in the <strong>Logistics</strong> page first.</p>
      </div>
    );
  }

  const courierById = new Map(couriers.map((c) => [c.objectId, c]));
  const enabledCount = methods.filter((m) => checked[m.objectId] ?? true).length;

  return (
    <div className="tc-plugin" style={{ padding: "1rem" }}>
      <h2>Delivery Options</h2>
      {error && <p className="tc-error">{error}</p>}
      {savedOk && <p style={{ color: "green" }}>Saved successfully.</p>}
      <p style={{ marginBottom: "0.5rem" }}>
        <span className={`tc-badge ${enabledCount > 0 ? "tc-badge--success" : "tc-badge--danger"}`}>
          {enabledCount} of {methods.length} method{methods.length !== 1 ? "s" : ""} available
        </span>
      </p>
      <table className="tc-table" style={{ marginBottom: "1rem" }}>
        <thead>
          <tr>
            <th>Courier</th>
            <th>Method</th>
            <th>Code</th>
            <th align="right">Available?</th>
          </tr>
        </thead>
        <tbody>
          {methods.map((m) => (
            <tr key={m.objectId}>
              <td>{courierById.get(m.courierId)?.name ?? "—"}</td>
              <td>{m.name}</td>
              <td>{m.code}</td>
              <td align="right">
                <input
                  type="checkbox"
                  checked={checked[m.objectId] ?? true}
                  onChange={(e) =>
                    setChecked((prev) => ({ ...prev, [m.objectId]: e.target.checked }))
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="tc-primary-button" onClick={() => void handleSave()} disabled={saving}>
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
