/**
 * RFC 9727 API Catalog + companion machine-readable descriptions.
 *
 *   GET /.well-known/api-catalog   → application/linkset+json
 *   GET /openapi.json              → OpenAPI 3.1 for the public HTTP + MCP surfaces
 *   GET /api/health                → liveness for the `status` link relation
 *
 * Catalog entries use the RFC 8631 link relations from Appendix A.1 of RFC 9727:
 * service-desc (OpenAPI), service-doc (human docs), status (health).
 */
export { apiCatalogDocument, apiCatalogRoute } from './catalog';
export { openapiDocument, openapiRoute } from './openapi';
export { healthRoute } from './health';
