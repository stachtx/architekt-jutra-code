import type { PluginObject } from "../../sdk";

export interface Courier {
  objectId: string;
  name: string;
  code: string;
  description: string;
}

export interface DeliveryMethod {
  objectId: string;
  courierId: string;
  name: string;
  code: string;
  description: string;
}

export interface ProductLogistics {
  objectId: string;
  disabledMethodIds: string[];
}

export function toCourier(obj: PluginObject): Courier {
  return {
    objectId: obj.objectId,
    name: obj.data.name as string,
    code: obj.data.code as string,
    description: (obj.data.description as string) ?? "",
  };
}

export function toDeliveryMethod(obj: PluginObject): DeliveryMethod {
  return {
    objectId: obj.objectId,
    courierId: obj.data.courierId as string,
    name: obj.data.name as string,
    code: obj.data.code as string,
    description: (obj.data.description as string) ?? "",
  };
}

export function toProductLogistics(obj: PluginObject): ProductLogistics {
  return {
    objectId: obj.objectId,
    disabledMethodIds: (obj.data.disabledMethodIds as string[]) ?? [],
  };
}

export function isMethodEnabled(logistics: ProductLogistics | null, methodId: string): boolean {
  if (!logistics) return true;
  return !logistics.disabledMethodIds.includes(methodId);
}
