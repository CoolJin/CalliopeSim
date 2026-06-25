import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Square, AlertCircle, Info, CheckCircle, Copy, AlignLeft, Sparkles, Bug, Rocket, BookOpen, Wand2, HelpCircle, Volume2, VolumeX } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { StateField, StateEffect } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { indentRange } from '@codemirror/language';
import type { CalliopeState } from './CalliopeState';
import { initialCalliopeState } from './CalliopeState';
import { CalliopeInterpreter } from './Interpreter';
import { geminiService } from './GeminiService';
import { audioService } from './AudioService';
import Silk from './components/Silk';

type LogMessage = {
  id: number;
  text: string;
  type: 'info' | 'error' | 'success';
};

type ChatMessage = {
  role: 'user' | 'model';
  text: string;
};

// CodeMirror Highlight Logic
const setLineHighlights = StateEffect.define<number[]>();
const clearLineHighlights = StateEffect.define<void>();

const highlightField = StateField.define({
  create() { return Decoration.none },
  update(lines, tr) {
    lines = lines.map(tr.changes);
    if (tr.docChanged) {
      lines = Decoration.none;
    }
    for (let e of tr.effects) {
      if (e.is(setLineHighlights)) {
        const decos = e.value.map(pos => Decoration.line({class: "cm-highlighted-line"}).range(pos));
        decos.sort((a, b) => a.from - b.from);
        lines = Decoration.set(decos);
      } else if (e.is(clearLineHighlights)) {
        lines = Decoration.none;
      }
    }
    return lines;
  },
  provide: f => EditorView.decorations.from(f)
});

const DEFAULT_CODE = `#define _GNU_SOURCE

#include "MicroBit.h"
#include "NEPODefs.h"
#include <list>
#include <array>
#include <stdlib.h>
MicroBit _uBit;



int main()
{
    _uBit.init();

    
    
    release_fiber();
}`;

// Typewriter component for AI responses
const TypewriterText = ({ text, speed = 15, onComplete }: { text: string, speed?: number, onComplete?: () => void }) => {
  const [displayedText, setDisplayedText] = useState('');
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);
  
  useEffect(() => {
    let i = 0;
    setDisplayedText('');
    const interval = setInterval(() => {
      i++;
      setDisplayedText(text.substring(0, i));
      if (i >= text.length) {
        clearInterval(interval);
        if (onCompleteRef.current) onCompleteRef.current();
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return <>{displayedText}</>;
};

function App() {
  const [code, setCode] = useState(() => {
    return localStorage.getItem('calliope_code') || DEFAULT_CODE;
  });
  const [state, setState] = useState<CalliopeState>(initialCalliopeState);
  const [btnA, setBtnA] = useState(false);
  const [btnB, setBtnB] = useState(false);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Chatbot states
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem('calliope_chat_history');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    return [];
  });
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showPresets, setShowPresets] = useState(() => {
    const saved = localStorage.getItem('calliope_chat_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) return false;
      } catch (e) { }
    }
    return true;
  });
  const [apiCapacity, setApiCapacity] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [showPostRunPrompt, setShowPostRunPrompt] = useState(false);
  const [isConsoleButtonPulsing, setIsConsoleButtonPulsing] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  // Check for mobile layout
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // References
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const btnARef = useRef(btnA);
  const btnBRef = useRef(btnB);
  const logsRef = useRef(logs);
  const chatHistoryRef = useRef(chatHistory);
  const stateRef = useRef(state);
  const postRunPromptTimerRef = useRef<number | null>(null);
  const showPresetsTimerRef = useRef<number | null>(null);
  useEffect(() => { btnARef.current = btnA; }, [btnA]);
  useEffect(() => { btnBRef.current = btnB; }, [btnB]);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  useEffect(() => { chatHistoryRef.current = chatHistory; }, [chatHistory]);
  useEffect(() => { stateRef.current = state; }, [state]);

  // Persist code and chat history
  useEffect(() => {
    localStorage.setItem('calliope_code', code);
  }, [code]);

  useEffect(() => {
    localStorage.setItem('calliope_chat_history', JSON.stringify(chatHistory));
  }, [chatHistory]);

  const handleTypewriterComplete = useCallback(() => {
    if (showPresetsTimerRef.current) clearTimeout(showPresetsTimerRef.current);
    showPresetsTimerRef.current = window.setTimeout(() => {
      setShowPresets(true);
      // Wait for grid transition to complete (0.5s), then scroll down so messages aren't hidden
      setTimeout(() => {
        chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 550);
    }, 2000);
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isTyping]);

  const interpreterRef = useRef<CalliopeInterpreter | null>(null);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  useEffect(() => {
    // Initialize interpreter
    const interpreter = new CalliopeInterpreter({
      getState: () => stateRef.current,
      setState: (newState) => setState(prev => ({ ...prev, ...newState })),
      getButtonA: () => btnARef.current,
      getButtonB: () => btnBRef.current,
      getPinTouched: (pin: 'P0' | 'P1' | 'P2' | 'P3') => {
        const s = stateRef.current;
        return s.pins[pin].touched;
      },
      getPinDigital: (pin: 'P0' | 'P1' | 'P2' | 'P3') => {
        const s = stateRef.current;
        return s.pins[pin].digitalValue;
      },
      setPinDigital: (pin: 'P0' | 'P1' | 'P2' | 'P3', value: number) => {
        setState(prev => ({
          ...prev,
          pins: {
            ...prev.pins,
            [pin]: { ...prev.pins[pin], digitalValue: value }
          }
        }));
      },
      sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
      log: (text, type = 'info') => {
        setLogs(prev => [...prev, { id: Date.now() + Math.random(), text, type }]);
      },
      checkAbort: () => {
        // Handled internally by the interpreter's shouldAbort flag now
      }
    });
    
    interpreter.init().then(() => {
      // Overwrite logs so StrictMode double-calls only show one success message
      setLogs([{ id: Date.now(), text: 'Parser erfolgreich geladen.', type: 'success' }]);
    }).catch(err => {
      setLogs([{ id: Date.now(), text: `Parser-Initialisierung fehlgeschlagen: ${err.message}`, type: 'error' }]);
    });
    interpreterRef.current = interpreter;
  }, []);

  const handleRun = async () => {
    if (!interpreterRef.current) return;
    setLogs([]); // clear logs
    setIsRunning(true);
    setShowPostRunPrompt(false);
    setIsConsoleButtonPulsing(false);
    
    if (postRunPromptTimerRef.current) clearTimeout(postRunPromptTimerRef.current);
    postRunPromptTimerRef.current = window.setTimeout(() => {
      setShowPostRunPrompt(true);
    }, 2000);
    
    // Clear line highlights when executing
    const view = cmRef.current?.view;
    if (view) {
      view.dispatch({ effects: clearLineHighlights.of() });
    }

    await interpreterRef.current.execute(code);
    setIsRunning(false);
    
    if (logsRef.current.some(l => l.type === 'error')) {
      setIsConsoleButtonPulsing(true);
    }
  };

  const handleStop = () => {
    if (interpreterRef.current) {
      interpreterRef.current.stop();
    }
    setState(initialCalliopeState); // Reset UI
    setIsRunning(false);
  };

  const handleFormatCode = () => {
    const view = cmRef.current?.view;
    if (!view) return;
    const changes = indentRange(view.state, 0, view.state.doc.length);
    if (!changes.empty) {
      view.dispatch({ changes });
    }
  };

  const handleSendChat = async (presetMsg?: string) => {
    const userMsg = presetMsg || chatInput;
    if (!userMsg.trim() || isTyping) return;
    
    if (!presetMsg) setChatInput('');
    if (postRunPromptTimerRef.current) clearTimeout(postRunPromptTimerRef.current);
    if (showPresetsTimerRef.current) clearTimeout(showPresetsTimerRef.current);
    setShowPostRunPrompt(false);
    setShowPresets(false);
    setIsConsoleButtonPulsing(false);
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsTyping(true);

    const view = cmRef.current?.view;
    
    // Clear line highlights when asking a new question
    if (view) {
      view.dispatch({ effects: clearLineHighlights.of() });
    }

    try {
      const consoleOutput = logs.map(l => l.text).join('\n');
      const { text: responseText, remainingCapacity } = await geminiService.sendMessage(userMsg, chatHistory, code, consoleOutput);
      
      setApiCapacity(remainingCapacity);
      let response = responseText;

      if (view) {
        let linesToMark: number[] = [];
        const regex = /<mark_line>(\d+)<\/mark_line>/g;
        response = response.replace(regex, (_match: string, lineNumStr: string) => {
          const lineNum = parseInt(lineNumStr);
          if (!isNaN(lineNum) && lineNum >= 1 && lineNum <= view.state.doc.lines) {
            linesToMark.push(lineNum);
          }
          return lineNumStr;
        });

        if (linesToMark.length > 0) {
          const positions = linesToMark.map(ln => view.state.doc.line(ln).from);
          view.dispatch({ effects: setLineHighlights.of(positions) });
          // Scroll first marked line into view
          view.dispatch({ effects: EditorView.scrollIntoView(positions[0], { y: "center" }) });
        }
      }

      setChatHistory(prev => [...prev, { role: 'model', text: response }]);
    } catch (e: any) {
      setApiCapacity(0);
      let errorMsg = e.message || String(e);
      if (errorMsg.includes("503") || errorMsg.includes("high demand") || errorMsg.includes("overloaded")) {
        errorMsg = "Die Server der KI sind gerade stark ausgelastet. Bitte versuche es in ein paar Sekunden nochmal.";
      } else if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("rate limit")) {
        errorMsg = "Zu viele Anfragen auf einmal. Bitte warte einen Moment, bevor du eine neue Frage stellst.";
      } else if (errorMsg.includes("fetch") || errorMsg.includes("network")) {
        errorMsg = "Netzwerkfehler. Bitte überprüfe deine Internetverbindung.";
      } else {
        errorMsg = "Ein unbekannter Fehler ist bei der Anfrage aufgetreten. Bitte versuche es noch einmal.";
      }
      setChatHistory(prev => [...prev, { role: 'model', text: 'Fehler: ' + errorMsg }]);
    } finally {
      setIsTyping(false);
    }
  };

  if (isMobile) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        background: '#0f172a',
        color: 'white',
        textAlign: 'center',
        padding: '24px'
      }}>
        <AlertCircle size={48} color="#ef4444" style={{ marginBottom: '24px' }} />
        <h2 style={{ fontSize: '24px', marginBottom: '16px', color: '#f8fafc' }}>Nicht unterstützt</h2>
        <p style={{ fontSize: '16px', color: '#cbd5e1', maxWidth: '400px', lineHeight: '1.6' }}>
          Diese Seite kann leider nur auf Desktop-Geräten (PC, Laptop) verwendet werden.
        </p>
      </div>
    );
  }

  return (
    <div className="app-container floating-layout">
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, opacity: 0.3, pointerEvents: 'none' }}>
        <Silk color="#ffffff" speed={2} />
      </div>
      <div className="left-panel" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: '-20px', left: '4px', color: 'rgba(255,255,255,0.3)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          made by Colin
        </div>
        <div className="floating-panel editor-panel" style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 10, display: 'flex', gap: '8px' }}>
            <button 
              onClick={() => handleSendChat("Was könnte man an meinem Code verbessern?")}
              title="KI nach Tipps fragen"
              disabled={isTyping}
              className="btn-glass btn-glass-primary"
              style={{ padding: '10px 16px', borderRadius: '18px', cursor: isTyping ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', opacity: isTyping ? 0.5 : 1 }}
            >
              <Sparkles size={16} /> Verbesserungsvorschläge
            </button>
            <button 
              onClick={handleFormatCode}
              title="Code formatieren"
              disabled={isTyping}
              className="btn-glass"
              style={{ padding: '10px 16px', borderRadius: '18px', cursor: isTyping ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', opacity: isTyping ? 0.5 : 1 }}
            >
              <AlignLeft size={16} /> Formatieren
            </button>
          </div>
          <CodeMirror
            ref={cmRef}
            value={code}
            height="100%"
            theme="dark"
            extensions={[cpp(), highlightField]}
            readOnly={isTyping}
            onChange={(value) => {
              setCode(value);
              if (postRunPromptTimerRef.current) clearTimeout(postRunPromptTimerRef.current);
              setShowPostRunPrompt(false);
              setIsConsoleButtonPulsing(false);
              handleStop();
            }}
            className={`cm-editor-wrapper ${isTyping ? 'disabled' : ''}`}
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              highlightActiveLine: true
            }}
          />
        </div>
        <div className="floating-panel console-panel">
          <div className="console-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Konsolenausgabe</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {logs.some(l => l.type === 'error') && (
                <button 
                  className={`btn-glass btn-glass-danger animate-fade-in ${isConsoleButtonPulsing ? 'animate-error-pulse' : ''}`}
                  onClick={() => handleSendChat("Warum funktioniert mein Code nicht?")}
                  title="KI nach Fehler fragen"
                  disabled={isTyping}
                  style={{ padding: '10px 16px', borderRadius: '18px', cursor: isTyping ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', opacity: isTyping ? 0.5 : 1 }}
                >
                  <Bug size={16} /> KI fragen
                </button>
              )}
              <button 
                className="btn-glass" 
                onClick={(e) => {
                  navigator.clipboard.writeText(logs.map(l => l.text).join('\n'));
                  const btn = e.currentTarget;
                  const originalText = btn.innerHTML;
                  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #4ade80"><path d="M20 6 9 17l-5-5"/></svg> Kopiert!';
                  btn.style.color = '#4ade80';
                  setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.color = '';
                  }, 2000);
                }}
                title="Konsolenausgabe kopieren"
                style={{ padding: '10px 16px', borderRadius: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}
              >
                <Copy size={16} /> Kopieren
              </button>
            </div>
          </div>
          <div className="console-messages">
            {logs.map((log) => (
              <div key={log.id} className={`${log.type}`}>
                {log.type === 'error' && <AlertCircle size={14} style={{display:'inline', marginRight:4, verticalAlign:'middle'}} />}
                {log.type === 'success' && <CheckCircle size={14} style={{display:'inline', marginRight:4, verticalAlign:'middle'}} />}
                {log.type === 'info' && <Info size={14} style={{display:'inline', marginRight:4, verticalAlign:'middle'}} />}
                {log.text}
              </div>
            ))}
            {logs.length === 0 && <div className="info">Bereit zum Kompilieren.</div>}
          </div>
        </div>
      </div>

      <div className="middle-panel">
        <div className="floating-panel ai-chat-panel" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', color: '#6366F1', margin: 0, textShadow: '0 0 10px rgba(99, 102, 241, 0.3)' }}>KI-Assistent</h3>
            {apiCapacity !== null && (
              <div className="api-quota-bar" title="Modell-Qualität / Server-Ressourcen" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ 
                  width: '60px', height: '6px', background: 'rgba(255,255,255,0.1)', 
                  borderRadius: '3px', overflow: 'hidden' 
                }}>
                  <div style={{ 
                    width: `${apiCapacity}%`, height: '100%', 
                    background: apiCapacity > 50 ? '#10b981' : apiCapacity > 20 ? '#f59e0b' : '#ef4444', 
                    boxShadow: `0 0 8px ${apiCapacity > 50 ? 'rgba(16, 185, 129, 0.4)' : apiCapacity > 20 ? 'rgba(245, 158, 11, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
                    transition: 'width 0.4s ease, background 0.4s ease' 
                  }} />
                </div>
                <span style={{ fontSize: '12px', color: '#94a3b8', fontFamily: 'Fira Code, monospace', minWidth: '32px', textAlign: 'right' }}>
                  {apiCapacity}%
                </span>
              </div>
            )}
          </div>
          <div className="chat-messages inner-glass-box" style={{ flex: 1, borderRadius: '24px', padding: '16px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)' }}>
            {chatHistory.length === 0 && (
              <div className="info" style={{ marginBottom: '16px', lineHeight: '1.5' }}>
                Hallo! Wie kann ich dir heute beim Programmieren helfen? Ich sehe deinen C++ Code und deine Fehler automatisch.
              </div>
            )}
            

            {chatHistory.map((msg, idx) => (
              <div key={idx} className="message-appear" style={{ 
                marginBottom: '12px', 
                padding: '10px 14px', 
                borderRadius: '12px',
                background: msg.role === 'user' ? 'rgba(249, 115, 22, 0.05)' : 'var(--surface)',
                border: msg.role === 'user' ? '1px solid rgba(249, 115, 22, 0.1)' : '1px solid var(--border)',
                color: msg.role === 'user' ? '#ffedd5' : 'var(--foreground)',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                whiteSpace: 'pre-wrap',
                fontFamily: msg.role === 'model' ? 'Inter, sans-serif' : 'inherit',
                transition: 'all var(--easing) 0.3s'
              }}>
                <strong style={{ display: 'block', marginBottom: '4px', color: msg.role === 'user' ? '#f97316' : '#38bdf8', fontSize: '12px' }}>
                  {msg.role === 'user' ? 'Du' : 'KI Assistent'}
                </strong>
                {msg.role === 'model' && idx === chatHistory.length - 1 ? (
                  <TypewriterText text={msg.text} speed={15} onComplete={handleTypewriterComplete} />
                ) : (
                  msg.text
                )}
              </div>
            ))}
            {isTyping && (
              <div style={{ 
                margin: '16px auto', 
                padding: '4px 0', 
                alignSelf: 'center',
                display: 'flex',
                justifyContent: 'center',
                width: '100%'
              }}>
                <div className="typing-dots">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={chatMessagesEndRef} />
          </div>
          <div className={`presets-wrapper ${showPresets ? 'open' : ''}`}>
            <div className="presets-inner" style={{ 
              display: 'flex', flexDirection: 'column', gap: '8px', 
              opacity: showPresets ? 1 : 0, transition: 'opacity 0.4s ease 0.1s', 
              overflow: 'hidden', padding: '12px', margin: '-12px' 
            }}>
              <button 
                onClick={() => handleSendChat("Wie fange ich an?")}
                className="preset-btn btn-glass"
              >
                <Rocket size={16} color="var(--accent)" /> Wie fange ich an?
              </button>
              <button 
                onClick={() => handleSendChat("Was sind die wichtigsten Befehle?")}
                className="preset-btn btn-glass"
              >
                <BookOpen size={16} color="var(--accent)" /> Was sind die wichtigsten Befehle?
              </button>
              <button 
                onClick={() => handleSendChat("Gebe mir eine Programmieraufgabe.")}
                className="preset-btn btn-glass"
              >
                <Info size={16} color="var(--accent)" /> Gebe mir eine Programmieraufgabe.
              </button>
              <button 
                onClick={() => handleSendChat("Warum funktioniert mein Code nicht?")}
                className="preset-btn btn-glass"
              >
                <Bug size={16} color="var(--accent)" /> Warum funktioniert mein Code nicht?
              </button>
              <button 
                onClick={() => handleSendChat("Was könnte man an meinem Code verbessern?")}
                className="preset-btn btn-glass"
              >
                <Wand2 size={16} color="var(--accent)" /> Was könnte man an meinem Code verbessern?
              </button>
            </div>
          </div>
          <div className="chat-input" style={{ display: 'flex', marginTop: '16px', gap: '8px' }}>
            <input 
              type="text" 
              placeholder="Stelle eine Frage..." 
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendChat()}
              className="chat-input-field"
            />
            <button className="btn btn-glass btn-glass-primary btn-pill" onClick={() => handleSendChat()} disabled={isTyping}>Senden</button>
          </div>
        </div>
      </div>

      <div className="right-panel">
        <div className="floating-panel simulator-panel">
          <div className="control-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minHeight: '36px' }}>
            <div className="left-controls" style={{ display: 'flex', alignItems: 'center' }}>
              {showPostRunPrompt && !isTyping && (
                <div className="animate-fade-in" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#cbd5e1' }}>
                  <HelpCircle size={16} color="#818cf8" />
                  Funktioniert etwas nicht? 
                  <button 
                    onClick={() => handleSendChat("Warum funktioniert mein Code nicht?")}
                    className="btn-glass btn-glass-primary"
                    style={{ padding: '10px 16px', borderRadius: '18px', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.2s' }}
                  >
                    <Bug size={16} /> KI fragen
                  </button>
                </div>
              )}
            </div>
            
            <div className="right-controls">
              {!isRunning ? (
                <button className="btn btn-glass btn-glass-primary" onClick={handleRun} disabled={isTyping} title={isTyping ? "Warte auf KI..." : ""}><Play size={16} /> Code ausführen</button>
              ) : (
                <button className="btn btn-glass btn-glass-danger" onClick={handleStop}><Square size={16} /> Ausführung stoppen</button>
              )}
            </div>
          </div>

          <div className="calliope-board-wrapper" style={{ position: 'relative' }}>
            <div className="calliope-board">
              <img src={`${import.meta.env.BASE_URL}calliope_clean.png`} alt="Calliope Board" className="calliope-bg" onError={(e) => e.currentTarget.style.display = 'none'} />
              <button 
                onClick={() => {
                  const muted = audioService.toggleMute();
                  setIsMuted(muted);
                }}
                style={{
                  position: 'absolute',
                  top: '20%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 10,
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: isMuted ? '#ef4444' : '#10b981',
                  backdropFilter: 'blur(4px)',
                  transition: 'all 0.2s',
                  boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
                }}
                title={isMuted ? "Ton einschalten" : "Ton ausschalten"}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)';
                  e.currentTarget.style.transform = 'translateX(-50%) scale(1.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(0, 0, 0, 0.4)';
                  e.currentTarget.style.transform = 'translateX(-50%) scale(1)';
                }}
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>

              {/* 5x5 LED Matrix */}
              <div className="led-matrix absolute-matrix">
                {state.ledMatrix.map((row, rIdx) => 
                  row.map((val, cIdx) => (
                    <div key={`${rIdx}-${cIdx}`} className={`led ${val ? 'on' : ''}`} />
                  ))
                )}
              </div>

              {/* RGB LED */}
              <div 
                className="rgb-led absolute-rgb" 
                style={{
                  backgroundColor: (state.rgbLed[0] === 0 && state.rgbLed[1] === 0 && state.rgbLed[2] === 0) ? 'transparent' : `rgb(${state.rgbLed[0]}, ${state.rgbLed[1]}, ${state.rgbLed[2]})`,
                  border: (state.rgbLed[0] === 0 && state.rgbLed[1] === 0 && state.rgbLed[2] === 0) ? '2px solid rgba(255,255,255,0.4)' : '2px solid transparent',
                  boxShadow: (state.rgbLed[0] === 0 && state.rgbLed[1] === 0 && state.rgbLed[2] === 0) ? 'none' : `0 0 15px rgb(${state.rgbLed[0]}, ${state.rgbLed[1]}, ${state.rgbLed[2]})`
                }} 
              />

              {/* Buttons */}
              <div 
                className={`calliope-btn btn-a ${btnA ? 'pressed' : ''}`}
                onMouseDown={() => setBtnA(true)}
                onMouseUp={() => setBtnA(false)}
                onMouseLeave={() => setBtnA(false)}
                title="Button A"
              >A</div>
              <div 
                className={`calliope-btn btn-b ${btnB ? 'pressed' : ''}`}
                onMouseDown={() => setBtnB(true)}
                onMouseUp={() => setBtnB(false)}
                onMouseLeave={() => setBtnB(false)}
                title="Button B"
              >B</div>
              <div 
                className={`calliope-btn btn-a-b ${(btnA && btnB) ? 'pressed' : ''}`}
                onMouseDown={() => { setBtnA(true); setBtnB(true); }}
                onMouseUp={() => { setBtnA(false); setBtnB(false); }}
                onMouseLeave={() => { setBtnA(false); setBtnB(false); }}
                title="Button A+B"
              >
                A+B
              </div>

              {/* Pin connectors */}
              <div className="pin pin-minus" title="Pin -"><span className="pin-label label-bottom-right">-</span></div>
              <div className="pin pin-plus" title="Pin +"><span className="pin-label label-bottom-left">+</span></div>
              <div 
                className={`pin pin-0 ${state.pins.P0.touched ? 'pressed' : ''}`} 
                title="Pin 0"
                onMouseDown={() => setState(p => ({...p, pins: {...p.pins, P0: {...p.pins.P0, touched: true}}}))}
                onMouseUp={() => setState(p => ({...p, pins: {...p.pins, P0: {...p.pins.P0, touched: false}}}))}
                onMouseLeave={() => setState(p => ({...p, pins: {...p.pins, P0: {...p.pins.P0, touched: false}}}))}
              ><span className="pin-label label-right">0</span></div>
              <div 
                className={`pin pin-1 ${state.pins.P1.touched ? 'pressed' : ''}`} 
                title="Pin 1"
                onMouseDown={() => setState(p => ({...p, pins: {...p.pins, P1: {...p.pins.P1, touched: true}}}))}
                onMouseUp={() => setState(p => ({...p, pins: {...p.pins, P1: {...p.pins.P1, touched: false}}}))}
                onMouseLeave={() => setState(p => ({...p, pins: {...p.pins, P1: {...p.pins.P1, touched: false}}}))}
              ><span className="pin-label label-top-right">1</span></div>
              <div 
                className={`pin pin-2 ${state.pins.P2.touched ? 'pressed' : ''}`} 
                title="Pin 2"
                onMouseDown={() => setState(p => ({...p, pins: {...p.pins, P2: {...p.pins.P2, touched: true}}}))}
                onMouseUp={() => setState(p => ({...p, pins: {...p.pins, P2: {...p.pins.P2, touched: false}}}))}
                onMouseLeave={() => setState(p => ({...p, pins: {...p.pins, P2: {...p.pins.P2, touched: false}}}))}
              ><span className="pin-label label-top-left">2</span></div>
              <div 
                className={`pin pin-3 ${state.pins.P3.touched ? 'pressed' : ''}`} 
                title="Pin 3"
                onMouseDown={() => setState(p => ({...p, pins: {...p.pins, P3: {...p.pins.P3, touched: true}}}))}
                onMouseUp={() => setState(p => ({...p, pins: {...p.pins, P3: {...p.pins.P3, touched: false}}}))}
                onMouseLeave={() => setState(p => ({...p, pins: {...p.pins, P3: {...p.pins.P3, touched: false}}}))}
              ><span className="pin-label label-left">3</span></div>
            </div>
          </div>
          
          {/* Variables tracking */}
          <div className="variables-panel">
            <h3>Variablen</h3>
            {Object.entries(state.variables).length === 0 && (
              <div className="var-item"><span className="var-name">Keine Variablen erfasst</span></div>
            )}
            {Object.entries(state.variables).map(([name, val]) => {
              let typeStr: string = typeof val;
              if (typeStr === 'number') {
                typeStr = Number.isInteger(val) ? 'int' : 'float';
              } else if (typeStr === 'boolean') {
                typeStr = 'bool';
              } else if (typeStr === 'string') {
                typeStr = 'string';
              }
              
              return (
                <div className="var-item" key={name}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="var-type">{typeStr}</span>
                    <span className="var-name">{name}</span>
                  </div>
                  <span className="var-val">{typeof val === 'string' ? `"${val}"` : String(val)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
