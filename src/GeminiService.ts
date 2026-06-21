import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEYS = [
  import.meta.env.VITE_GEMINI_API_KEY_1 || "",
  import.meta.env.VITE_GEMINI_API_KEY_2 || "",
  import.meta.env.VITE_GEMINI_API_KEY_3 || ""
].filter(Boolean);

class GeminiService {
  private currentKeyIndex = 0;

  private getClient() {
    return new GoogleGenerativeAI(API_KEYS[this.currentKeyIndex]);
  }

  public async sendMessage(userMessage: string, history: any[], currentCode: string, consoleOutput: string): Promise<string> {
    const numberedCode = currentCode.split('\n').map((line, idx) => `${idx + 1}: ${line}`).join('\n');
    
    const systemInstruction = `Du bist ein C++ Lernassistent für ein Informatikprojekt. 
Der Nutzer programmiert einen Calliope Mini in einem web-basierten Simulator (Open Roberta Lab kompatibel).
Hier ist sein aktueller C++ Code mit Zeilennummern:
\`\`\`cpp
${numberedCode}
\`\`\`

Hier ist die aktuelle Konsolenausgabe / Fehlermeldungen:
\`\`\`
${consoleOutput || "Keine Konsolenausgabe."}
\`\`\`

Antworte auf Deutsch. Hilf dem Schüler, seinen Code zu verstehen oder Fehler zu beheben. Gehe direkt auf sein Problem ein.
WICHTIG: Wenn du den Schüler auf einen Fehler in bestimmten Zeilen hinweisen möchtest, schreibe z.B. \`Zeile <mark_line>12</mark_line>\` oder für mehrere Zeilen \`Zeile <mark_line>12</mark_line> und <mark_line>13</mark_line>\`. Das Programm ersetzt den Tag automatisch durch die Nummer, sodass für den Schüler im Text normal "Zeile 12" steht, und markiert die betroffene Zeile im Editor auffällig gelb. Nutze dies gezielt für pädagogische Zwecke. Beachte: Du MUSST keine Zeilen markieren, wenn es nicht nötig ist. Du kannst Zeilennummern auch einfach ohne den Tag erwähnen, wenn sie nicht gelb leuchten sollen. Und du musst natürlich nicht immer mehrere Zeilen markieren.

CRITICAL FORMATTING & BEHAVIOR RULES:
1. Antworte EXTREM kurz, prägnant und komprimiert, um Tokens zu sparen. Keine langen Begrüßungen oder Ausschweifungen.
2. Verwende AUSSCHLIESSLICH Plain Text. Benutze absolut keine Markdown-Formatierungen (kein \`**fett**\`, keine \`\`\`cpp Codeblöcke \`\`\`, keine \`*\`). Wenn du Codebeispiele gibst, schreibe sie einfach als normalen Text ohne Formatierung.
3. Gib nicht einfach den fertigen Code vor, sondern hilf dem Schüler, selbst auf die Lösung zu kommen.
4. HALLUZINIERE KEINE BEFEHLE! Du darfst auf keinen Fall falsche Befehle erfinden oder falsche Erklärungen abgeben. Nenne nur existierende, echte Befehle aus dem Open Roberta / Calliope Ökosystem und erkläre diese zu 100% korrekt.`;

    const modelsToTry = [
      "gemini-flash-latest",
      "gemini-2.5-flash", 
      "gemini-3.5-flash", 
      "gemini-pro-latest",
      "gemini-3-pro-preview"
    ];

    for (let attempts = 0; attempts < API_KEYS.length; attempts++) {
      try {
        const genAI = this.getClient();
        
        let lastError = null;
        
        for (const modelName of modelsToTry) {
          try {
            const model = genAI.getGenerativeModel({ 
              model: modelName,
              systemInstruction: systemInstruction
            });

            const formattedHistory = history.map(msg => ({
              role: msg.role === 'model' ? 'model' : 'user',
              parts: [{ text: msg.text }]
            }));

            const chat = model.startChat({
              history: formattedHistory,
              generationConfig: { temperature: 0.7 }
            });

            const result = await chat.sendMessage(userMessage);
            return result.response.text();
          } catch (modelError: any) {
             console.warn(`Model ${modelName} failed on key ${this.currentKeyIndex}:`, modelError.message);
             lastError = modelError;
             // If it's a 404 (model not found) or 400 (not supported), try next model
             if (modelError.message?.includes("404") || modelError.message?.includes("not found")) {
                 continue;
             }
             // Otherwise (e.g. quota 429), break inner loop to switch API key
             break;
          }
        }
        
        if (lastError) throw lastError;

      } catch (error: any) {
        console.error(`Gemini API Error with key index ${this.currentKeyIndex}:`, error);
        
        if (attempts < API_KEYS.length - 1) {
          console.warn(`API Error or Quota exceeded. Switching from Key ${this.currentKeyIndex} to ${(this.currentKeyIndex + 1) % API_KEYS.length}...`);
          this.currentKeyIndex = (this.currentKeyIndex + 1) % API_KEYS.length;
          continue;
        }

        throw new Error("Fehler bei der KI-Anfrage: " + error.message);
      }
    }
    
    throw new Error("Der KI-Assistent ist momentan leider nicht erreichbar. Bitte versuche es später erneut.");
  }
}

export const geminiService = new GeminiService();
