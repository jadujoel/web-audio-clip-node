const DB_NAME = "clip-audio-store";
const DB_VERSION = 1;
const STORE_NAME = "files";
const LAST_FILE_KEY = "last-uploaded";

function openDB(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
	return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

export interface StoredFile {
	name: string;
	arrayBuffer: ArrayBuffer;
}

export async function saveUploadedFile(
	name: string,
	arrayBuffer: ArrayBuffer,
): Promise<void> {
	const db = await openDB();
	const store = tx(db, "readwrite");
	const data: StoredFile = { name, arrayBuffer };
	await new Promise<void>((resolve, reject) => {
		const req = store.put(data, LAST_FILE_KEY);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}

export async function loadUploadedFile(): Promise<StoredFile | null> {
	const db = await openDB();
	const store = tx(db, "readonly");
	return new Promise((resolve, reject) => {
		const req = store.get(LAST_FILE_KEY);
		req.onsuccess = () => resolve(req.result ?? null);
		req.onerror = () => reject(req.error);
	});
}
