
import { GoogleGenAI } from "@google/genai";
import { ItineraryItem, TourGuideData, Trip, Hotel } from "../types";

const STORAGE_KEY_GEMINI_COUNT = 'wanderlust_gemini_count';

export class GeminiService {
  static getUsageCount(): number {
    return parseInt(localStorage.getItem(STORAGE_KEY_GEMINI_COUNT) || '0', 10);
  }

  private static incrementUsage() {
    const count = this.getUsageCount();
    localStorage.setItem(STORAGE_KEY_GEMINI_COUNT, (count + 1).toString());
  }

  /**
   * Centralized method to generate content.
   * Automatically switches between Client SDK (if key exists) and Vercel Proxy.
   */
  private static async generate(model: string, contents: any, config?: any): Promise<{ text: string }> {
    this.incrementUsage();
    const apiKey = process.env.API_KEY;

    // STRATEGY 1: Client-Side SDK (Preferred for speed if key is available locally)
    if (apiKey && apiKey !== 'PASTE_YOUR_KEY_HERE') {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({ model, contents, config });
        return { text: response.text || '' };
      } catch (clientError) {
        console.warn("Client SDK failed, trying proxy...", clientError);
        // If client fails (e.g. region block), fall through to proxy
      }
    }

    // STRATEGY 2: Vercel Proxy (Serverless Function)
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, contents, config })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Proxy Error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // The proxy returns { text, candidates, ... }
      // We prioritize the pre-extracted text
      let text = data.text;
      
      // Fallback extraction if text is missing but candidates exist (raw structure)
      if (!text && data.candidates?.[0]?.content?.parts?.[0]) {
         const part = data.candidates[0].content.parts[0];
         text = part.text || '';
      }

      return { text: text || '' };

    } catch (proxyError) {
      console.error("Gemini Generation Failed (Proxy):", proxyError);
      throw proxyError;
    }
  }

  private static extractJson(text: string | undefined): any {
    if (!text) return null;
    try {
      // 1. Try direct parse
      return JSON.parse(text);
    } catch (e) {
      // 2. Try extracting from markdown block
      const jsonBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonBlockMatch) {
        try { return JSON.parse(jsonBlockMatch[1]); } catch (e2) {}
      }
      // 3. Try finding the first { and last }
      const firstOpen = text.indexOf('{');
      const lastClose = text.lastIndexOf('}');
      if (firstOpen !== -1 && lastClose !== -1) {
        try { return JSON.parse(text.substring(firstOpen, lastClose + 1)); } catch (e3) {}
      }
      console.warn("Failed to extract JSON from response:", text.substring(0, 100) + "...");
      return null;
    }
  }

  static async translateTrip(trip: Trip, language: string): Promise<Trip | null> {
    try {
      const languageNames: Record<string, string> = {
        'en': 'English',
        'zh-TW': 'Traditional Chinese',
        'ja': 'Japanese',
        'ko': 'Korean'
      };
      const targetLanguage = languageNames[language] || 'English';

      const minimalTrip = {
        title: trip.title,
        location: trip.location,
        description: trip.description,
        itinerary: trip.itinerary
      };

      const prompt = `
      Translate the following JSON object's text values to ${targetLanguage}.
      Preserve structure EXACTLY. Only translate: "title", "description", "location", "transportMethod", "spendingDescription".
      Do NOT translate IDs, times, numbers, or currency codes.
      Input: ${JSON.stringify(minimalTrip)}
      Return ONLY valid JSON.
      `;

      const { text } = await this.generate('gemini-2.5-flash', prompt, { responseMimeType: 'application/json' });
      const translatedData = this.extractJson(text);
      if (!translatedData) return null;

      return {
        ...trip,
        title: translatedData.title || trip.title,
        location: translatedData.location || trip.location,
        description: translatedData.description || trip.description,
        itinerary: translatedData.itinerary || trip.itinerary
      };
    } catch (e) {
      console.error("Translation failed:", e);
      return null;
    }
  }

  static async getExchangeRate(fromCurrency: string, toCurrency: string, date?: string): Promise<number | null> {
    try {
      const dateQuery = date ? `on ${date}` : "today";
      const prompt = `
      Find the exact exchange rate from ${fromCurrency} to ${toCurrency} ${dateQuery}.
      Return ONLY a raw JSON object: { "rate": 145.5 }
      `;

      const { text } = await this.generate('gemini-2.5-flash', prompt, { tools: [{ googleSearch: {} }] });
      const result = this.extractJson(text);
      return result?.rate || null;
    } catch (e) {
      console.error("Exchange rate fetch failed:", e);
      return null;
    }
  }

  static async editImage(base64Image: string, prompt: string): Promise<string | null> {
    try {
      const parts = base64Image.split(',');
      if (parts.length < 2) throw new Error("Invalid base64 image string");
      
      const cleanBase64 = parts[1];
      const mimeTypeMatch = parts[0].match(/:(.*?);/);
      const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/png';

      const contents = [
        {
          parts: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: mimeType,
              },
            },
            {
              text: prompt,
            },
          ],
        }
      ];

      const apiKey = process.env.API_KEY;
      let response;

      if (apiKey && apiKey !== 'PASTE_YOUR_KEY_HERE') {
         const ai = new GoogleGenAI({ apiKey });
         response = await ai.models.generateContent({
            model: 'gemini-3-pro-image-preview',
            contents
         });
      } else {
         const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gemini-3-pro-image-preview', contents })
         });
         if (!res.ok) throw new Error('Proxy error');
         response = await res.json();
      }

      const candidates = response.candidates;
      if (!candidates?.[0]?.content?.parts) return null;

      for (const part of candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
      return null;
    } catch (error) {
      console.error('Error editing image:', error);
      return null;
    }
  }

  static async generateImage(prompt: string): Promise<string | null> {
    try {
      const contents = { parts: [{ text: prompt }] };
      const apiKey = process.env.API_KEY;
      let response;

      if (apiKey && apiKey !== 'PASTE_YOUR_KEY_HERE') {
         const ai = new GoogleGenAI({ apiKey });
         response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents
         });
      } else {
         const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gemini-2.5-flash-image', contents })
         });
         if (!res.ok) throw new Error('Proxy error');
         response = await res.json();
      }

      const candidates = response.candidates;
      if (!candidates?.[0]?.content?.parts) return null;

      for (const part of candidates[0].content.parts) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
      return null;
    } catch (e) {
      console.error("Image generation failed:", e);
      return null;
    }
  }

  static async getEventLogistics(location: string, item: ItineraryItem, prevLocation: string | null, language: string = 'en'): Promise<{ price?: number, currency?: string, transportShort?: string, details?: string } | null> {
    try {
      const origin = prevLocation ? `from "${prevLocation}"` : 'from the city center';
      const prompt = `
      Planning trip to "${location}". Event: "${item.title}" (${item.description}).
      Task: Find entry price & best transport ${origin}.
      Return STRICT JSON: { "price": number, "currency": "string", "transportShort": "string", "details": "string" }
      Translate details to ${language}.
      `;

      const { text } = await this.generate('gemini-2.5-flash', prompt, { tools: [{ googleSearch: {} }] });
      return this.extractJson(text);
    } catch (e) {
      console.error("Logistics research failed:", e);
      return null;
    }
  }

  static async getTourGuideInfo(location: string, item: ItineraryItem, language: string = 'en'): Promise<TourGuideData | null> {
    try {
      const prompt = `
      Expert tour guide for "${item.title}" in "${location}".
      Find latest stories and tips.
      Return JSON: { "story": "...", "mustEat": [], "mustOrder": [], "souvenirs": [], "reservationTips": "..." }
      Translate to ${language}.
      `;

      const { text } = await this.generate('gemini-2.5-flash', prompt, { tools: [{ googleSearch: {} }] });
      return this.extractJson(text) as TourGuideData;
    } catch (error) {
      console.error('Error getting tour guide info:', error);
      return null;
    }
  }

  static async getWeatherForecast(location: string, startDate: string, endDate: string): Promise<Record<string, { icon: string, temp: string, condition: string }> | null> {
    try {
      const prompt = `
      Forecast for ${location} from ${startDate} to ${endDate}.
      Return JSON keys YYYY-MM-DD, values { "icon": "emoji", "temp": "range", "condition": "text" }.
      `;

      const { text } = await this.generate('gemini-2.5-flash', prompt, { responseMimeType: 'application/json' });
      return this.extractJson(text);
    } catch (e) {
      console.error("Weather fetch failed:", e);
      return null;
    }
  }

  static async optimizeSchedule(items: ItineraryItem[], date: string): Promise<ItineraryItem[] | null> {
    try {
      const minimalItems = items.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        type: item.type
      }));

      const prompt = `
      Optimize the schedule for these events on ${date}.
      Assign realistic start times (HH:mm) and periods (morning/afternoon/night) assuming a 9 AM start.
      Return JSON: { "schedule": [ { "id": "item_id", "time": "09:00", "period": "morning" } ] }
      Input Items: ${JSON.stringify(minimalItems)}
      `;

      const { text } = await this.generate('gemini-2.5-flash', prompt, { responseMimeType: 'application/json' });
      const result = this.extractJson(text);
      
      if (!result || !result.schedule) return null;

      const scheduleMap = new Map<string, any>(result.schedule.map((s: any) => [s.id, s]));

      const optimizedItems = items.map(item => {
        const s = scheduleMap.get(item.id);
        if (s) {
          return { ...item, time: s.time, period: s.period };
        }
        return item;
      });
      
      return optimizedItems.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    } catch (e) {
      console.error("Schedule optimization failed:", e);
      return null;
    }
  }

  static async generateTripItinerary(
    location: string, 
    days: number, 
    budget: number, 
    currency: string,
    interests: string, 
    language: string
  ): Promise<Partial<Trip> | null> {
    try {
      const prompt = `
      Create ${days}-day itinerary for ${location}. Budget: ${currency}${budget}. Interests: "${interests}".
      Return JSON: { "title": "", "description": "", "itinerary": { "1": [ { "time": "09:00", "type": "sightseeing", "title": "", "description": "", "estimatedExpense": 0, "currency": "${currency}", "transportMethod": "" } ] } }
      Translate to ${language}.
      `;

      const { text } = await this.generate('gemini-2.5-flash', prompt, { responseMimeType: 'application/json' });
      return this.extractJson(text);
    } catch (e) {
      console.error("Trip generation failed:", e);
      return null;
    }
  }

  static async recommendHotels(location: string, itinerary: ItineraryItem[], preferences: string, language: string): Promise<Hotel[]> {
    try {
      const placeList = itinerary.map(item => item.title).slice(0, 15).join(", ");
      const prompt = `
      Recommend 3-4 hotels in "${location}" near: ${placeList}. Preferences: "${preferences}".
      Return JSON: { "hotels": [ { "name": "", "description": "", "address": "", "price": "", "rating": 4.5, "amenities": [], "bookingUrl": "", "reason": "" } ] }
      Translate to ${language}.
      `;

      const { text } = await this.generate('gemini-2.5-flash', prompt, { tools: [{ googleSearch: {} }] });
      const result = this.extractJson(text);
      if (!result || !result.hotels) return [];
      
      return (result.hotels || []).map((h: any) => ({ ...h, id: Math.random().toString(36).substr(2, 9) }));
    } catch (e) {
      console.error("Hotel recommendation failed:", e);
      return [];
    }
  }

  static async extractHotelInfo(url: string, language: string = 'en'): Promise<Partial<Hotel> | null> {
    try {
      const prompt = `
      Analyze this hotel website or search for this hotel: "${url}".
      Extract details: Name, Description, Address, typical Price, Rating, Amenities, Check-in time, Check-out time, Room Types, Services Included.
      Return JSON: { 
        "name": "", 
        "description": "", 
        "address": "", 
        "price": "", 
        "rating": 0, 
        "amenities": [], 
        "checkIn": "", 
        "checkOut": "",
        "roomType": "",
        "servicesIncluded": "",
        "notes": ""
      }
      Translate content to ${language}.
      `;
      
      const { text } = await this.generate('gemini-2.5-flash', prompt, { tools: [{ googleSearch: {} }] });
      return this.extractJson(text);
    } catch (e) {
      console.error("Hotel extraction failed:", e);
      return null;
    }
  }
}
