import Dexie, { Table } from 'dexie';
import { Expedition, Finding, FindingFields } from './models';

interface Meta { key: string; value: string; }

/** Local on-device database (IndexedDB). Everything is saved here FIRST. */
class FieldSyncDb extends Dexie {
  findings!: Table<Finding, string>;
  expeditions!: Table<Expedition, number>;
  meta!: Table<Meta, string>;

  constructor() {
    super('fieldsync');
    this.version(1).stores({
      findings: 'id, syncStatus, expeditionId, serverVersion, capturedAt',
      expeditions: 'id',
      meta: 'key',
    });
  }

  async getMeta(key: string): Promise<string | null> {
    return (await this.meta.get(key))?.value ?? null;
  }
  async setMeta(key: string, value: string): Promise<void> {
    await this.meta.put({ key, value });
  }
}

export const db = new FieldSyncDb();

/** A stable id for this device, created once and kept in the local DB. */
export async function getDeviceId(): Promise<string> {
  let id = await db.getMeta('deviceId');
  if (!id) {
    id = crypto.randomUUID();
    await db.setMeta('deviceId', id);
  }
  return id;
}

/** Save a brand-new finding locally as 'pending' (the outbox). The device generates the id, so this works offline. */
export async function addFinding(fields: FindingFields, engineerName: string, gpsAccuracyM: number | null = null): Promise<void> {
  const now = new Date().toISOString();
  await db.findings.add({
    ...fields, notes: fields.notes.trim(), id: crypto.randomUUID(), gpsAccuracyM, engineerName, deviceId: await getDeviceId(),
    capturedAt: now, clientUpdatedAt: now, baseServerVersion: null, serverVersion: null, isDeleted: false, syncStatus: 'pending',
  });
}
