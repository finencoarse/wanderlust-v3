
import { ItineraryItem } from '../types';

export class NominatimService {
  static async searchPlace(query: string, locationContext: string): Promise<Partial<ItineraryItem> | null> {
    try {
      const fetchWithQuery = async (q: string) => {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=1`;
        try {
            const response = await fetch(url, {
                headers: {
                'Accept-Language': 'en-US,en;q=0.9' // Prefer English for consistency
                }
            });
            if (!response.ok) return null;
            const data = await response.json();
            return data && data.length > 0 ? data[0] : null;
        } catch (e) {
            return null;
        }
      };

      // 1. Try with context (e.g. "Gwangjang Market, Seoul")
      let result = await fetchWithQuery(`${query}, ${locationContext}`);

      // 2. Fallback: If failed, and context context contains commas (e.g. "Osaka, Seoul, Busan"),
      // try just the query (e.g. "Gwangjang Market") as it might be specific enough globally.
      if (!result && locationContext.includes(',')) {
         result = await fetchWithQuery(query);
      }

      if (!result) return null;
      
      // Map OSM category/type to app types
      // Nominatim returns 'class' (broad) and 'type' (specific)
      let appType: 'eating' | 'sightseeing' | 'shopping' | 'transport' | 'hotel' | 'other' = 'other';
      const t = (result.type || '').toLowerCase();
      const c = (result.class || '').toLowerCase();
      
      if (['restaurant', 'cafe', 'bar', 'pub', 'food_court', 'fast_food', 'ice_cream'].includes(t) || c === 'amenity' && t === 'food') {
        appType = 'eating';
      } else if (['museum', 'attraction', 'viewpoint', 'artwork', 'monument', 'historic', 'theme_park', 'zoo', 'aquarium', 'gallery'].includes(t) || c === 'tourism' || c === 'historic') {
        appType = 'sightseeing';
      } else if (['shop', 'mall', 'supermarket', 'convenience', 'department_store', 'clothes', 'fashion'].includes(c) || c === 'shop') {
        appType = 'shopping';
      } else if (['bus_stop', 'station', 'subway', 'aerodrome', 'taxi', 'stop'].includes(t) || c === 'highway' || c === 'railway') {
        appType = 'transport';
      } else if (['hotel', 'motel', 'hostel', 'guest_house', 'apartment'].includes(t)) {
        appType = 'hotel';
      }

      return {
        title: result.name || query, // Fallback to query if name is missing (e.g. strict address)
        address: result.display_name,
        type: appType,
        description: `Found via OpenStreetMap (${c}/${t})`,
        estimatedExpense: 0,
        currency: 'USD',
        // Parse coordinates as numbers
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon)
      };
    } catch (error) {
      console.error("Nominatim Search Error:", error);
      return null;
    }
  }
}
