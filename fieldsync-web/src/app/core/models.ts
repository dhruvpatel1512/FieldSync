export type SyncStatus = 'pending' | 'synced' | 'conflict' | 'rejected';
export type HydrocarbonIndicator = 'None' | 'OilShow' | 'GasShow';

export const MATERIAL_TYPES = [
  'Sandstone', 'Shale', 'Limestone', 'Dolomite', 'Siltstone',
  'Claystone', 'Conglomerate', 'Salt', 'Coal', 'Basalt',
] as const;

export interface Expedition {
  id: number;
  name: string;
  region: string;
  minLat: number; maxLat: number; minLon: number; maxLon: number;
}

/** One field observation: where it was found and what was found there. */
export interface Finding {
  id: string;                    // GUID generated ON THE DEVICE (works offline)
  expeditionId: number;
  latitude: number;
  longitude: number;
  gpsAccuracyM: number | null;
  materialType: string;
  hydrocarbonIndicator: HydrocarbonIndicator;
  depthM: number;
  notes: string;
  engineerName: string;
  deviceId: string;
  capturedAt: string;            // ISO timestamp, device clock
  clientUpdatedAt: string;       // ISO timestamp of the last local edit
  baseServerVersion: number | null; // server version this edit was based on (null = new)
  serverVersion: number | null;  // assigned by the server after a successful sync
  isDeleted: boolean;
  // ---- local-only fields ----
  syncStatus: SyncStatus;
  syncErrors?: string[];
  qualityFlags?: string[];
}

export interface PushResult {
  id: string;
  status: 'accepted' | 'duplicate' | 'conflict' | 'rejected';
  serverVersion: number | null;
  errors: string[];
  qualityFlags: string[];
}
