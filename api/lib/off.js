/**
 * Open Food Facts client with timeout + retry.
 */

const OFF_BASE    = 'https://world.openfoodfacts.org/api/v2/product';
const TIMEOUT_MS  = 6000;
const USER_AGENT  = 'Tasted/1.0 (https://github.com/CamMcl2/tasted)';

export async function fetchFromOFF(barcode) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res  = await fetch(`${OFF_BASE}/${barcode}.json`, {
      signal:  controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timer);

    if (!res.ok) return null;

    const json = await res.json();
    if (json.status !== 1 || !json.product) return null;

    return json.product;
  } catch {
    clearTimeout(timer);
    return null;
  }
}
