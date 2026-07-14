/**
 * Explicit virtual hardware inventories used by the deterministic simulator.
 * These profiles describe training devices; they are not claims that every IOS
 * XE platform exposes the same interfaces or command set.
 */

export type DeviceProfileId = "router-ios-xe" | "catalyst-l2";

export type InterfaceFamily =
  | "Ethernet"
  | "FastEthernet"
  | "GigabitEthernet"
  | "TenGigabitEthernet"
  | "FortyGigabitEthernet"
  | "HundredGigE"
  | "Port-channel"
  | "Vlan";

export interface DeviceProfile {
  id: DeviceProfileId;
  label: string;
  hostname: "R1" | "SW1";
  role: "router" | "layer-2-switch";
  interfaces: readonly string[];
  capabilities: Readonly<{
    routing: boolean;
    switching: boolean;
    dhcpServer: boolean;
    radiusClient: boolean;
    subinterfaces: boolean;
    interfaceRanges: boolean;
    compactInterfaceRanges: boolean;
    namedAcls: boolean;
  }>;
}

const routerInterfaces = [
  "FastEthernet0/0/1",
  "GigabitEthernet0/0/0",
  "GigabitEthernet0/0/1",
  "GigabitEthernet0/0",
  "GigabitEthernet0/1",
  "TenGigabitEthernet0/1/1",
  "Loopback0",
] as const;

const catalystInterfaces = [
  ...Array.from({ length: 24 }, (_, index) => `FastEthernet1/0/${index + 1}`),
  ...Array.from({ length: 4 }, (_, index) => `GigabitEthernet1/0/${index + 1}`),
  "FastEthernet0/0/1",
  "GigabitEthernet0/0/1",
  "GigabitEthernet0/1",
  "TenGigabitEthernet1/1/1",
  "TenGigabitEthernet1/1/2",
  "FortyGigabitEthernet0/1/1",
  "Port-channel1",
  "Vlan10",
  "Vlan20",
  "Vlan99",
] as const;

export const deviceProfiles: Readonly<Record<DeviceProfileId, DeviceProfile>> = {
  "router-ios-xe": {
    id: "router-ios-xe",
    label: "IOS XE training router",
    hostname: "R1",
    role: "router",
    interfaces: routerInterfaces,
    capabilities: {
      routing: true,
      switching: false,
      dhcpServer: true,
      radiusClient: true,
      subinterfaces: true,
      interfaceRanges: false,
      compactInterfaceRanges: false,
      namedAcls: true,
    },
  },
  "catalyst-l2": {
    id: "catalyst-l2",
    label: "Catalyst Layer 2 training switch",
    hostname: "SW1",
    role: "layer-2-switch",
    interfaces: catalystInterfaces,
    capabilities: {
      routing: false,
      switching: true,
      dhcpServer: false,
      radiusClient: true,
      subinterfaces: false,
      interfaceRanges: true,
      compactInterfaceRanges: true,
      namedAcls: true,
    },
  },
};

export const getDeviceProfile = (id: DeviceProfileId = "router-ios-xe"): DeviceProfile =>
  deviceProfiles[id];

const familyAliases: Readonly<Record<string, InterfaceFamily>> = {
  ethernet: "Ethernet",
  et: "Ethernet",
  fastethernet: "FastEthernet",
  fa: "FastEthernet",
  gigabitethernet: "GigabitEthernet",
  gi: "GigabitEthernet",
  tengigabitethernet: "TenGigabitEthernet",
  te: "TenGigabitEthernet",
  fortygigabitethernet: "FortyGigabitEthernet",
  fo: "FortyGigabitEthernet",
  hundredgige: "HundredGigE",
  hu: "HundredGigE",
  "port-channel": "Port-channel",
  portchannel: "Port-channel",
  po: "Port-channel",
  vlan: "Vlan",
  vl: "Vlan",
};

const interfaceParts = (value: string): { family: InterfaceFamily; identifier: string } | null => {
  const compact = value.trim().replace(/\s+/gu, "");
  const match = /^([a-z-]+)(\d+(?:\/\d+)*(?:\.\d+)?)$/iu.exec(compact);
  if (!match) return null;
  const family = familyAliases[match[1].toLocaleLowerCase("en-GB")];
  return family ? { family, identifier: match[2] } : null;
};

/** Resolve only interfaces that exist on the selected virtual device. */
export const normaliseInterfaceName = (
  value: string,
  profile: DeviceProfile,
): string | null => {
  const parts = interfaceParts(value);
  if (!parts) return null;
  const canonical = `${parts.family}${parts.identifier}`;
  const inventory = new Map(profile.interfaces.map((name) => [name.toLocaleLowerCase("en-GB"), name]));
  const declared = inventory.get(canonical.toLocaleLowerCase("en-GB"));
  if (declared) return declared;

  if (profile.capabilities.subinterfaces && parts.identifier.includes(".")) {
    const [parentId, subinterface] = parts.identifier.split(".");
    const parent = inventory.get(`${parts.family}${parentId}`.toLocaleLowerCase("en-GB"));
    const subinterfaceNumber = Number(subinterface);
    if (parent && Number.isInteger(subinterfaceNumber) && subinterfaceNumber >= 1 && subinterfaceNumber <= 4094) {
      return `${parent}.${subinterfaceNumber}`;
    }
  }
  return null;
};

const expandRange = (
  first: string,
  lastPortText: string,
  profile: DeviceProfile,
): string[] | null => {
  const start = normaliseInterfaceName(first, profile);
  if (!start) return null;
  const match = /^(.*\/)(\d+)$/u.exec(start);
  if (!match) return null;
  const firstPort = Number(match[2]);
  const lastPort = Number(lastPortText);
  if (!Number.isInteger(lastPort) || lastPort < firstPort || lastPort - firstPort > 47) return null;
  const values = Array.from({ length: lastPort - firstPort + 1 }, (_, index) => `${match[1]}${firstPort + index}`);
  return values.every((name) => normaliseInterfaceName(name, profile) === name) ? values : null;
};

/** Parse the IOS-style `first - last-port` form for a declared range-capable profile. */
export const parseInterfaceRange = (
  value: string,
  profile: DeviceProfile,
): string[] | null => {
  if (!profile.capabilities.interfaceRanges) return null;
  const spaced = /^(\S+)\s+-\s+(\d+)$/u.exec(value.trim());
  if (spaced) return expandRange(spaced[1], spaced[2], profile);
  if (!profile.capabilities.compactInterfaceRanges) return null;
  const compact = /^(\S+)-(\d+)$/u.exec(value.trim());
  return compact ? expandRange(compact[1], compact[2], profile) : null;
};

export const interfaceFamily = (name: string): InterfaceFamily | null =>
  interfaceParts(name)?.family ?? null;
