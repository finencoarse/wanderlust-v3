
export class GroqService {
  // Helper to get key with fallback
  private static getApiKey(): string {
    const envKey = process.env.GROQ_API_KEY;
    const hardcodedKey = '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';
    
    // Check if env var is missing or is the placeholder text
    if (!envKey || envKey.trim() === '' || envKey === 'PASTE_YOUR_KEY_HERE') {
      return hardcodedKey;
    }
    return envKey;
  }

  static async generateRouteIntro(locations: string[], language: string = 'en'): Promise<string | null> {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      console.warn("Groq API Key is missing.");
      return null;
    }

    // Construct a language-aware prompt
    const langMap: Record<string, string> = {
      'en': 'English',
      'zh-TW': 'Traditional Chinese (Taiwan)',
      'ja': 'Japanese',
      'ko': 'Korean'
    };
    const targetLang = langMap[language] || 'English';

    const prompt = `
      You are an enthusiastic travel guide.
      The user has just optimized their route for the day.
      Here is the new logical order of visits: ${locations.join(' -> ')}.
      
      Please write a short, exciting, and practical introduction (max 2-3 sentences) describing this flow.
      Focus on efficiency and the vibe of the journey.
      Output ONLY the text in ${targetLang}.
    `;

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          model: 'llama-3.1-8b-instant', // Updated from decommissioned llama3-8b-8192
          temperature: 0.7,
          max_tokens: 150
        })
      });

      if (!response.ok) {
        // Try to parse the error body for more details
        let errorMessage = response.statusText;
        try {
          const errorData = await response.json();
          if (errorData && errorData.error && errorData.error.message) {
            errorMessage = errorData.error.message;
          } else {
            errorMessage = JSON.stringify(errorData);
          }
        } catch (e) {
          // If json parse fails, stick to statusText or status code
          errorMessage = errorMessage || `Status Code ${response.status}`;
        }
        throw new Error(`Groq API Error: ${errorMessage}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || null;
    } catch (error) {
      console.error("Groq generation failed:", error);
      return null;
    }
  }
}
