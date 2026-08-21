// Runs the deliberately-slow Hub KDF off the main thread.

import { backupFileName, createHubBackup } from './backup';

export interface BackupWorkerRequest {
  requestId: number;
  seedHex: string;
  password: string;
}

export type BackupWorkerResponse =
  | { requestId: number; ok: true; fileName: string; json: string }
  | { requestId: number; ok: false; message: string };

const post = (message: BackupWorkerResponse) => {
  (self as unknown as { postMessage(message: BackupWorkerResponse): void }).postMessage(message);
};

self.onmessage = (event: MessageEvent<BackupWorkerRequest>) => {
  const { requestId, seedHex, password } = event.data;
  try {
    const seed = new Uint8Array(seedHex.length / 2);
    for (let i = 0; i < seed.length; i++) seed[i] = parseInt(seedHex.slice(i * 2, i * 2 + 2), 16);
    const backup = createHubBackup(seed, password);
    post({
      requestId,
      ok: true,
      fileName: backupFileName(backup.address0),
      json: `${JSON.stringify(backup)}\n`,
    });
  } catch (error) {
    post({ requestId, ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
