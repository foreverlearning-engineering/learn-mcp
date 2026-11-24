// Settings that are facts about the Conversations API, kept in one place so each one changes once.

export const SERVER_NAME = 'conversations';
export const SERVER_VERSION = '0.1.0';
export const USER_AGENT = 'conversations-mcp/' + SERVER_VERSION;

// The interface version every request names (FL-API-Version).
export const API_VERSION = '2026-12-01';

// The production API host. A developer testing on staging sets FOREVERLEARNING_BASE_URL.
export const DEFAULT_BASE_URL = 'https://developers-api.foreverlearning.ai/v1';

// The price, as the public copy says it. There is no free test allowance for the Conversations API
// today, so every turn is paid; the opening and the closeout are turns too.
export const PRICE_LINE = '3¢ per text turn';
