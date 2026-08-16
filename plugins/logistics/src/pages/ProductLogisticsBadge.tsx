import { useEffect, useState } from "react";
import { getSDK } from "../../../sdk";
import { toDeliveryMethod, toProductLogistics, isMethodEnabled } from "../domain";

export function ProductLogisticsBadge() {
  const [enabledCount, setEnabledCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const sdk = getSDK();
  const productId = sdk.thisPlugin.productId ?? "";

  useEffect(() => {
    if (!productId) { setLoading(false); return; }

    async function load() {
      try {
        const [methodObjects, logisticsObj] = await Promise.all([
          sdk.thisPlugin.objects.list("delivery_method"),
          sdk.thisPlugin.objects.get("product_logistics", productId).catch(() => null),
        ]);
        const methods = methodObjects.map(toDeliveryMethod);
        const logistics = logisticsObj ? toProductLogistics(logisticsObj) : null;
        setEnabledCount(methods.filter((m) => isMethodEnabled(logistics, m.objectId)).length);
      } catch {
        setEnabledCount(null);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [productId]);

  if (loading || enabledCount === null) return null;

  return (
    <span className={`tc-badge ${enabledCount > 0 ? "tc-badge--success" : "tc-badge--danger"}`}>
      {enabledCount > 0
        ? `${enabledCount} delivery method${enabledCount !== 1 ? "s" : ""}`
        : "No delivery available"}
    </span>
  );
}
