import { getSDK } from "../../sdk";

const DEFAULT_COURIERS = [
  { code: "DHL",    name: "DHL",            description: "Domestic & international shipments" },
  { code: "DPD",    name: "DPD",            description: "Parcel delivery across Europe" },
  { code: "INPOST", name: "InPost",         description: "Parcel lockers & courier" },
  { code: "POCZTA", name: "Poczta Polska",  description: "National postal service" },
];

const DEFAULT_METHODS: Array<{ courierCode: string; code: string; name: string; description: string }> = [
  { courierCode: "DHL",    code: "DHL_EXPRESS",       name: "DHL Express",                description: "Next-day delivery" },
  { courierCode: "DHL",    code: "DHL_PARCEL",         name: "DHL Parcel",                 description: "Standard parcel" },
  { courierCode: "DPD",    code: "DPD_CLASSIC",        name: "DPD Classic",                description: "Standard 2–3 day" },
  { courierCode: "DPD",    code: "DPD_PICKUP",         name: "DPD Pickup",                 description: "Parcel pickup point" },
  { courierCode: "INPOST", code: "INPOST_LOCKER",      name: "InPost Paczkomat 24/7",      description: "Parcel locker" },
  { courierCode: "POCZTA", code: "POCZTA_PRIORYTET",   name: "Poczta Polska Priorytet",    description: "Priority letter/parcel" },
];

export async function seedDefaults(): Promise<void> {
  const sdk = getSDK();
  const courierIds: Record<string, string> = {};

  for (const c of DEFAULT_COURIERS) {
    const id = crypto.randomUUID();
    courierIds[c.code] = id;
    await sdk.thisPlugin.objects.save("courier", id, {
      name: c.name,
      code: c.code,
      description: c.description,
    });
  }

  for (const m of DEFAULT_METHODS) {
    const courierId = courierIds[m.courierCode];
    if (!courierId) continue;
    await sdk.thisPlugin.objects.save("delivery_method", crypto.randomUUID(), {
      courierId,
      name: m.name,
      code: m.code,
      description: m.description,
    });
  }
}
