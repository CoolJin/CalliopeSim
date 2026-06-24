import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEYS = [
  import.meta.env.VITE_GEMINI_API_KEY_1 || "",
  import.meta.env.VITE_GEMINI_API_KEY_2 || "",
  import.meta.env.VITE_GEMINI_API_KEY_3 || "",
  import.meta.env.VITE_GEMINI_API_KEY_4 || "",
  import.meta.env.VITE_GEMINI_API_KEY_5 || ""
].filter(Boolean);

class GeminiService {
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
WICHTIG ZUR ZEILENMARKIERUNG: Wenn du \`Zeile <mark_line>12</mark_line>\` schreibst, wird die Zeile für den Schüler im Editor grell gelb markiert. ACHTUNG: Der Schüler interpretiert eine markierte Zeile IMMER als "Hier muss ich etwas tun" oder "Hier ist das Problem". Der Fokus des Schülers wird komplett darauf gelenkt. Markiere Zeilen also AUSSCHLIESSLICH dann, wenn dort tatsächlich ein Problem vorliegt oder der Schüler dort etwas ändern muss. Wenn du nur etwas erklärst oder allgemein auf Zeilen verweist, erwähne die Zeilennummern komplett OHNE den \`<mark_line>\` Tag!

CRITICAL FORMATTING & BEHAVIOR RULES:
1. Antworte EXTREM kurz, prägnant und komprimiert. Schreibe nicht zu viel, wenn es nicht von Bedeutung ist, um den Schüler nicht zu verwirren. Jedes geschriebene Wort sollte Sinn und Bedeutung haben. Keine langen Begrüßungen oder Ausschweifungen.
2. Verwende AUSSCHLIESSLICH Plain Text. Benutze absolut keine Markdown-Formatierungen (kein \`**fett**\`, keine \`\`\`cpp Codeblöcke \`\`\`, keine \`*\`). Wenn du Codebeispiele gibst, schreibe sie einfach als normalen Text ohne Formatierung.
3. Gib nicht einfach den fertigen Code vor, sondern hilf dem Schüler, selbst auf die Lösung zu kommen.
4. HALLUZINIERE KEINE BEFEHLE! Du darfst auf keinen Fall falsche Befehle erfinden. Nenne nur existierende Befehle aus der folgenden Liste und erkläre diese zu 100% korrekt.

LISTE ALLER VERFÜGBAREN CALLIOPE BEFEHLE IN DIESEM SIMULATOR:
- _uBit.display.scroll(String): Scrollt einen Text über das 5x5 LED-Display.
- _uBit.display.print(String/Number): Zeigt ein einzelnes Zeichen oder eine Ziffer an.
- _uBit.display.clear(): Löscht alle LEDs auf dem Display (schaltet sie aus).
- _uBit.display.image.setPixelValue(x, y, wert): Schaltet eine bestimmte LED auf dem 5x5 Gitter. x und y (0 bis 4) sind die Koordinaten. wert (0 bis 255) ist die Helligkeit (255 = an, 0 = aus).
- _uBit.display.image.getPixelValue(x, y): Liest die Helligkeit (0-255) der LED an Koordinate x, y aus.
- _uBit.rgb.setColour(MicroBitColor(r, g, b, 255)): Setzt die Farbe der RGB-LED. r, g, und b stehen für Rot, Grün und Blau (jeweils 0 bis 255).
- _uBit.rgb.off(): Schaltet die RGB-LED komplett aus.
- _uBit.sleep(ms): Pausiert das Programm für die angegebene Anzahl an Millisekunden (z.B. 1000 für 1 Sekunde).
- _uBit.buttonA.isPressed(): Prüft, ob Knopf A gerade gedrückt ist (gibt true oder false zurück).
- _uBit.buttonB.isPressed(): Prüft, ob Knopf B gerade gedrückt ist (gibt true oder false zurück).
- _uBit.buttonAB.isPressed(): Prüft, ob Knopf A und B gleichzeitig gedrückt sind.
Du kannst diese Befehle dem Nutzer jederzeit vorschlagen, wenn er danach fragt oder wenn sie sein Problem lösen würden. Erkläre dabei immer kurz, wofür die Parameter in den Klammern stehen!`;

    // Modelle absteigend nach Qualität sortiert
    const MODELS = [
      "gemini-3.5-flash",
      "gemini-3-flash",
      "gemini-2.5-flash"
    ];

    let lastError: any = null;

    // Wir probieren zuerst das beste Modell über alle API-Keys hinweg, 
    // dann das zweitbeste über alle Keys, usw.
    // Da wir bei jedem Aufruf von vorne anfangen, wird auch immer wieder geprüft,
    // ob die besten Modelle (oder Keys) wieder verfügbar sind.
    for (const modelName of MODELS) {
      for (let keyIndex = 0; keyIndex < API_KEYS.length; keyIndex++) {
        try {
          const genAI = new GoogleGenerativeAI(API_KEYS[keyIndex]);
          const model = genAI.getGenerativeModel({ 
            model: modelName,
            systemInstruction: systemInstruction
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

          const chat = model.startChat({
            history: formattedHistory,
            generationConfig: { temperature: 0.7 }
          });

          const result = await chat.sendMessage(userMessage);
          console.log(`Successfully used model ${modelName} with API Key ${keyIndex + 1}`);
          return result.response.text();
          
        } catch (error: any) {
          console.warn(`Model ${modelName} failed on API Key ${keyIndex + 1}:`, error.message || error);
          lastError = error;
          // Bei jedem Fehler (Rate Limit, Model Not Found, 503) probieren wir den nächsten Key oder das nächste Modell
          continue;
        }
      }
    }
    
    // Wenn alle 9 Kombinationen fehlgeschlagen sind
    if (lastError) {
      throw new Error("Fehler bei der KI-Anfrage: " + (lastError.message || String(lastError)));
    }
    
    throw new Error("Der KI-Assistent ist momentan leider nicht erreichbar. Bitte versuche es später erneut.");
  }
}

export const geminiService = new GeminiService();
