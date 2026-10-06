import type { BrandKit, BrandKitDocument } from '@openroom/schema';
import { request } from './client';

export interface BrandPermissions { canEdit: boolean; brandingEnabled: boolean }
export const listBrandKits = (spaceId: string, trashed = false) => request<BrandPermissions & { brandKits: BrandKit[] }>(`/api/tutoring/spaces/${encodeURIComponent(spaceId)}/brand-kits${trashed ? '?trashed=1' : ''}`);
export const getBrandKit = (id: string) => request<BrandPermissions & { brandKit: BrandKit }>(`/api/tutoring/brand-kits/${encodeURIComponent(id)}`);
export const saveBrandKit = (spaceId: string, document: BrandKitDocument, previous?: BrandKit) => request<{ brandKit: BrandKit }>(previous ? `/api/tutoring/brand-kits/${encodeURIComponent(previous.id)}` : `/api/tutoring/spaces/${encodeURIComponent(spaceId)}/brand-kits`, {
  method: previous ? 'PATCH' : 'POST', mutating: true, body: JSON.stringify({ ...document, ...(previous ? { baseRevision: previous.revision } : {}) }),
});
export const trashBrandKit = (id: string) => request(`/api/tutoring/brand-kits/${encodeURIComponent(id)}`, { method: 'DELETE', mutating: true });
export const restoreBrandKit = (id: string) => request(`/api/tutoring/brand-kits/${encodeURIComponent(id)}/restore`, { method: 'POST', mutating: true });
