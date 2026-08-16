import { useEffect, useState, useCallback } from "react";
import { getSDK } from "../../../sdk";
import { toCourier, toDeliveryMethod } from "../domain";
import type { Courier, DeliveryMethod } from "../domain";
import { seedDefaults } from "../seed";

export function LogisticsAdminPage() {
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [methods, setMethods] = useState<DeliveryMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const [courierName, setCourierName] = useState("");
  const [courierCode, setCourierCode] = useState("");
  const [courierDescription, setCourierDescription] = useState("");

  const [methodCourierId, setMethodCourierId] = useState("");
  const [methodName, setMethodName] = useState("");
  const [methodCode, setMethodCode] = useState("");
  const [methodDescription, setMethodDescription] = useState("");

  const loadData = useCallback(async () => {
    try {
      const sdk = getSDK();
      const [courierObjects, methodObjects] = await Promise.all([
        sdk.thisPlugin.objects.list("courier"),
        sdk.thisPlugin.objects.list("delivery_method"),
      ]);
      setCouriers(courierObjects.map(toCourier));
      setMethods(methodObjects.map(toDeliveryMethod));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    }
  }, []);

  useEffect(() => {
    void loadData().finally(() => setLoading(false));
  }, [loadData]);

  async function handleAddCourier() {
    if (!courierName.trim()) { setError("Name is required"); return; }
    if (!courierCode.trim()) { setError("Code is required"); return; }
    const codeUpper = courierCode.trim().toUpperCase();
    if (couriers.some((c) => c.code.toUpperCase() === codeUpper)) {
      setError("A courier with this code already exists");
      return;
    }
    setError(null);
    try {
      const sdk = getSDK();
      await sdk.thisPlugin.objects.save("courier", crypto.randomUUID(), {
        name: courierName.trim(),
        code: codeUpper,
        description: courierDescription.trim(),
      });
      setCourierName("");
      setCourierCode("");
      setCourierDescription("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add courier");
    }
  }

  async function handleDeleteCourier(courierId: string) {
    if (methods.some((m) => m.courierId === courierId)) {
      setError("Cannot delete a courier that has delivery methods. Delete its methods first.");
      return;
    }
    setError(null);
    try {
      const sdk = getSDK();
      await sdk.thisPlugin.objects.delete("courier", courierId);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete courier");
    }
  }

  async function handleAddMethod() {
    if (!methodCourierId) { setError("Please select a courier"); return; }
    if (!methodName.trim()) { setError("Name is required"); return; }
    if (!methodCode.trim()) { setError("Code is required"); return; }
    const codeUpper = methodCode.trim().toUpperCase();
    if (methods.some((m) => m.code.toUpperCase() === codeUpper)) {
      setError("A delivery method with this code already exists");
      return;
    }
    setError(null);
    try {
      const sdk = getSDK();
      await sdk.thisPlugin.objects.save("delivery_method", crypto.randomUUID(), {
        courierId: methodCourierId,
        name: methodName.trim(),
        code: codeUpper,
        description: methodDescription.trim(),
      });
      setMethodName("");
      setMethodCode("");
      setMethodDescription("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add delivery method");
    }
  }

  async function handleDeleteMethod(methodId: string) {
    setError(null);
    try {
      const sdk = getSDK();
      await sdk.thisPlugin.objects.delete("delivery_method", methodId);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete delivery method");
    }
  }

  async function handleSeed() {
    setSeeding(true);
    setError(null);
    try {
      await seedDefaults();
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load defaults");
    } finally {
      setSeeding(false);
    }
  }

  const courierById = new Map(couriers.map((c) => [c.objectId, c]));

  if (loading) return <p>Loading...</p>;

  return (
    <div className="tc-plugin" style={{ padding: "1rem", maxWidth: 960 }}>
      <h1>Logistics</h1>
      {error && <p className="tc-error">{error}</p>}

      <section className="tc-section">
        <h2>Couriers</h2>
        {couriers.length === 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <button className="tc-ghost-button" onClick={() => void handleSeed()} disabled={seeding}>
              {seeding ? "Loading..." : "Load default carriers"}
            </button>
          </div>
        )}
        <div className="tc-flex" style={{ marginBottom: "1rem" }}>
          <input className="tc-input" placeholder="Name" value={courierName} onChange={(e) => setCourierName(e.target.value)} />
          <input className="tc-input" placeholder="Code (e.g. DHL)" value={courierCode} onChange={(e) => setCourierCode(e.target.value)} />
          <input className="tc-input" placeholder="Description (optional)" value={courierDescription} onChange={(e) => setCourierDescription(e.target.value)} />
          <button className="tc-primary-button" onClick={() => void handleAddCourier()}>Add</button>
        </div>
        {couriers.length === 0 ? (
          <p>No couriers yet. Add one above or load defaults.</p>
        ) : (
          <table className="tc-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Description</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {couriers.map((c) => (
                <tr key={c.objectId}>
                  <td>{c.name}</td>
                  <td>{c.code}</td>
                  <td>{c.description}</td>
                  <td>
                    <button
                      className="tc-ghost-button tc-ghost-button--danger"
                      onClick={() => void handleDeleteCourier(c.objectId)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="tc-section">
        <h2>Delivery Methods</h2>
        {couriers.length === 0 ? (
          <p>Add couriers first to configure delivery methods.</p>
        ) : (
          <>
            <div className="tc-flex" style={{ marginBottom: "1rem" }}>
              <select className="tc-select" value={methodCourierId} onChange={(e) => setMethodCourierId(e.target.value)}>
                <option value="">-- Select courier --</option>
                {couriers.map((c) => (
                  <option key={c.objectId} value={c.objectId}>{c.name}</option>
                ))}
              </select>
              <input className="tc-input" placeholder="Name" value={methodName} onChange={(e) => setMethodName(e.target.value)} />
              <input className="tc-input" placeholder="Code (e.g. DHL_EXPRESS)" value={methodCode} onChange={(e) => setMethodCode(e.target.value)} />
              <input className="tc-input" placeholder="Description (optional)" value={methodDescription} onChange={(e) => setMethodDescription(e.target.value)} />
              <button className="tc-primary-button" onClick={() => void handleAddMethod()}>Add</button>
            </div>
            {methods.length === 0 ? (
              <p>No delivery methods yet. Add one above.</p>
            ) : (
              <table className="tc-table">
                <thead>
                  <tr>
                    <th>Courier</th>
                    <th>Name</th>
                    <th>Code</th>
                    <th>Description</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {methods.map((m) => (
                    <tr key={m.objectId}>
                      <td>{courierById.get(m.courierId)?.name ?? "—"}</td>
                      <td>{m.name}</td>
                      <td>{m.code}</td>
                      <td>{m.description}</td>
                      <td>
                        <button
                          className="tc-ghost-button tc-ghost-button--danger"
                          onClick={() => void handleDeleteMethod(m.objectId)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </div>
  );
}
