import { GoogleGenAI } from "@google/genai";

const API_KEYS = [
  import.meta.env.VITE_GEMINI_API_KEY_1 || "",
  import.meta.env.VITE_GEMINI_API_KEY_2 || "",
  import.meta.env.VITE_GEMINI_API_KEY_3 || "",
  import.meta.env.VITE_GEMINI_API_KEY_4 || "",
  import.meta.env.VITE_GEMINI_API_KEY_5 || ""
].filter(Boolean);

class GeminiService {
  public async sendMessage(userMessage: string, history: any[], currentCode: string, consoleOutput: string): Promise<{ text: string; remainingCapacity: number }> {
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

Antworte auf Deutsch.
WICHTIG ZUR ZEILENMARKIERUNG: Wenn du \`Zeile <mark_line>12</mark_line>\` schreibst, wird die Zeile für den Schüler im Editor grell gelb markiert. Markiere Zeilen AUSSCHLIESSLICH dann, wenn dort tatsächlich ein Problem vorliegt oder der Schüler dort etwas ändern muss. Wenn du nur etwas erklärst, erwähne die Zeilennummer OHNE den \`<mark_line>\` Tag!

CRITICAL FORMATTING RULES:
1. Antworte EXTREM kurz und prägnant. Kein unnötiges Gerede. Verwende AUSSCHLIESSLICH Plain Text ohne jegliche Markdown-Formatierungen (kein \`**\`, keine Codeblöcke, keine \`*\`). 
2. Gib NIEMALS fertigen Code oder Codeschnipsel vor, es sei denn, der Nutzer bittet explizit darum!

PÄDAGOGISCHE REGELN:
- Sokratischer Dialog: Liefere keine direkten Antworten. Stelle stattdessen Leitfragen.
- Denkstrukturen vorgeben: Wenn der Schüler feststeckt, schlüssele das Problem nach dem EVA-Prinzip auf, um ihm einen roten Faden zu geben.
- Fehlerübersetzung: Übersetze kryptische C++ Compiler-Fehlermeldungen in normales, verständliches Deutsch.
- Fokus auf Kernkonzepte: Achte gezielt auf saubere if/else-Logik und die richtige Nutzung von Variablen, nicht nur auf Syntaxfehler.
- Startzeile: Wenn du dem Schüler sagst, wo er neuen Code beginnen soll, nenne IMMER exakt Zeile 16. Variiere nicht.

WHITELIST CALLIOPE BEFEHLE (Keine anderen erfinden!):
- _uBit.display.scroll(String)
- _uBit.display.print(String/Number)
- _uBit.display.clear()
- _uBit.display.image.setPixelValue(x, y, wert)
- _uBit.display.image.getPixelValue(x, y)
- _uBit.rgb.setColour(MicroBitColor(r, g, b, 255))
- _uBit.rgb.off()
- _uBit.sleep(ms)
- _uBit.buttonA.isPressed()
- _uBit.buttonB.isPressed()
- _uBit.buttonAB.isPressed()
- _uBit.soundmotor.soundOn(frequenz)
- _uBit.soundmotor.soundOff()
- _uBit.random(max)`;

    // Modelle absteigend nach Qualität sortiert
    const MODELS = [
      "gemini-3.5-flash",
      "gemini-3-flash-preview"
    ];

    let lastError: any = null;
    let attemptCount = 0;

    const PASSES = [
      { timeoutMs: 4000, name: "Fast Pass (4s)" },
      { timeoutMs: 15000, name: "Slow Pass (15s)" }
    ];

    const deadKeys = new Set<string>();

    for (const pass of PASSES) {
      for (let modelIndex = 0; modelIndex < MODELS.length; modelIndex++) {
        const modelName = MODELS[modelIndex];
        for (let keyIndex = 0; keyIndex < API_KEYS.length; keyIndex++) {
          const comboKey = `${modelName}-${keyIndex}`;
          if (deadKeys.has(comboKey)) continue;

          try {
            const ai = new GoogleGenAI({ 
              apiKey: API_KEYS[keyIndex]
            });

            const formattedHistory: any[] = [];
            let lastRole: string | null = null;
            
            for (const msg of history) {
              const role = msg.role === 'model' ? 'model' : 'user';
              if (role === 'model' && lastRole !== 'user') {
                formattedHistory.push({ role: 'user', parts: [{ text: '[Automatischer System-Prompt zur Code-Überprüfung]' }] });
              } else if (role === 'user' && lastRole === 'user') {
                formattedHistory.push({ role: 'model', parts: [{ text: '[System: Nutzer hat eine weitere Frage gestellt]' }] });
              }
              formattedHistory.push({ role, parts: [{ text: msg.text }] });
              lastRole = role;
            }

            // Füge die aktuelle User-Nachricht hinzu
            formattedHistory.push({ role: 'user', parts: [{ text: userMessage }] });

            // Timeout-Wrapper, um auf keinen Fall lange zu hängen
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error(`Timeout (${pass.name})`)), pass.timeoutMs);
            });

            const response = await Promise.race([
              ai.models.generateContent({
                model: modelName,
                contents: formattedHistory,
                config: {
                  systemInstruction: systemInstruction,
                  maxOutputTokens: 1000,
                  temperature: 0.2,
                }
              }),
              timeoutPromise
            ]) as any;

            const remainingCapacity = 100 - (attemptCount * 10);
            console.log(`Successfully used model ${modelName} with API Key ${keyIndex + 1} during ${pass.name}. Capacity: ${remainingCapacity}%`);
            return { text: response.text || "", remainingCapacity };
            
          } catch (error: any) {
            const isTimeout = error?.message?.includes('Timeout');
            console.warn(`Model ${modelName} failed on API Key ${keyIndex + 1} (${pass.name}):`, error.message || error);
            lastError = error;
            attemptCount++;
            
            // Wenn der Fehler KEIN Timeout war (z.B. Rate Limit 429), probieren wir diese Kombi im Slow Pass nicht nochmal
            if (!isTimeout) {
              deadKeys.add(comboKey);
            }
            continue;
          }
        }
      }
    }
    
    throw new Error(`Alle Modelle und API Keys sind aktuell überlastet oder fehlerhaft. Letzter Fehler: ${lastError?.message}`);
  }
}

export const geminiService = new GeminiService();
