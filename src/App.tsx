import { useState, useEffect, useRef } from 'react';
import { Play, Square, AlertCircle, Info, CheckCircle, Copy, AlignLeft } from 'lucide-react';
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

type LogMessage = {
  id: number;
  text: string;
  type: 'info' | 'error' | 'success';
};

type ChatMessage = {
  id?: number;
  role: 'user' | 'model';
  text: string;
  isAutomatedFeedback?: boolean;
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

function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [state, setState] = useState<CalliopeState>(initialCalliopeState);
  const [btnA, setBtnA] = useState(false);
  const [btnB, setBtnB] = useState(false);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Chatbot states
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [activePulseId, setActivePulseId] = useState<number | null>(null);

  // References
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const btnARef = useRef(btnA);
  const btnBRef = useRef(btnB);
  const logsRef = useRef(logs);
  const chatHistoryRef = useRef(chatHistory);
  useEffect(() => { btnARef.current = btnA; }, [btnA]);
  useEffect(() => { btnBRef.current = btnB; }, [btnB]);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  useEffect(() => { chatHistoryRef.current = chatHistory; }, [chatHistory]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isTyping]);

  const interpreterRef = useRef<CalliopeInterpreter | null>(null);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  useEffect(() => {
    // Initialize interpreter
    const interpreter = new CalliopeInterpreter({
      getState: () => state,
      setState: (newState) => setState(prev => ({ ...prev, ...newState })),
      getButtonA: () => btnARef.current,
      getButtonB: () => btnBRef.current,
      sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
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

  const triggerAutomatedFeedback = async () => {
    const prompt = "Der Nutzer hat die Simulation mit seinem Code gestartet, was sollte er verbessern, wenn es was zu verbessern gibt? (WICHTIG: Wenn der Code perfekt ist und es absolut nichts zu verbessern oder anzumerken gibt, antworte EXAKT mit dem Wort 'NO_FEEDBACK' und sonst nichts.)";
    
    try {
      const consoleOutput = logsRef.current.map(l => l.text).join('\n');
      let response = await geminiService.sendMessage(prompt, chatHistoryRef.current, code, consoleOutput);
      
      if (response.trim() !== 'NO_FEEDBACK') {
        const view = cmRef.current?.view;
        if (view) {
          let linesToMark: number[] = [];
          const regex = /<mark_line>(\d+)<\/mark_line>/g;
          response = response.replace(regex, (_match, lineNumStr) => {
            const lineNum = parseInt(lineNumStr);
            if (!isNaN(lineNum) && lineNum >= 1 && lineNum <= view.state.doc.lines) {
              linesToMark.push(lineNum);
            }
            return lineNumStr;
          });

          if (linesToMark.length > 0) {
            const decos = linesToMark.map(ln => view.state.doc.line(ln).from);
            if (decos.length > 0) {
              view.dispatch({
                effects: setLineHighlights.of(decos),
                scrollIntoView: true
              });
            }
          }
        }

        const newMsgId = Date.now();
        setChatHistory(prev => [...prev, { id: newMsgId, role: 'model', text: response, isAutomatedFeedback: true }]);
        setActivePulseId(newMsgId);
      }
    } catch (e) {
      // Ignoriere Fehler bei Hintergrundanfragen
    }
  };

  const handleRun = async () => {
    if (!interpreterRef.current) return;
    setLogs([]); // clear logs
    setIsRunning(true);
    setActivePulseId(null);
    
    // Clear line highlights when executing
    const view = cmRef.current?.view;
    if (view) {
      view.dispatch({ effects: clearLineHighlights.of() });
    }

    await interpreterRef.current.execute(code);
    setIsRunning(false);

    // Automatisiertes Feedback triggern (ohne isTyping zu setzen, damit Editor nicht gesperrt wird)
    triggerAutomatedFeedback();
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
    setActivePulseId(null);
    setChatHistory(prev => [...prev, { id: Date.now(), role: 'user', text: userMsg }]);
    setIsTyping(true);

    const view = cmRef.current?.view;
    
    // Clear line highlights when asking a new question
    if (view) {
      view.dispatch({ effects: clearLineHighlights.of() });
    }

    try {
      const consoleOutput = logs.map(l => l.text).join('\n');
      let response = await geminiService.sendMessage(userMsg, chatHistory, code, consoleOutput);
      
      if (view) {
        let linesToMark: number[] = [];
        const regex = /<mark_line>(\d+)<\/mark_line>/g;
        response = response.replace(regex, (_match, lineNumStr) => {
          const lineNum = parseInt(lineNumStr);
          if (!isNaN(lineNum) && lineNum >= 1 && lineNum <= view.state.doc.lines) {
            linesToMark.push(lineNum);
          }
          return lineNumStr;
        });

        if (linesToMark.length > 0) {
          const decos = linesToMark.map(ln => view.state.doc.line(ln).from);
          
          if (decos.length > 0) {
            view.dispatch({
              effects: setLineHighlights.of(decos),
              scrollIntoView: true
            });
          }
        }
      }

      setChatHistory(prev => [...prev, { id: Date.now(), role: 'model', text: response }]);
    } catch (e: any) {
      setChatHistory(prev => [...prev, { id: Date.now(), role: 'model', text: 'Fehler: ' + e.message }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="app-container floating-layout">
      <div className="left-panel" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: '-20px', left: '4px', color: 'rgba(255,255,255,0.3)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          made by Colin
        </div>
        <div className="floating-panel editor-panel" style={{ position: 'relative' }}>
          <button 
            onClick={handleFormatCode}
            title="Code formatieren"
            style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', transition: 'all 0.2s' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#94a3b8'; }}
          >
            <AlignLeft size={14} /> Formatieren
          </button>
          <CodeMirror
            ref={cmRef}
            value={code}
            height="100%"
            theme="dark"
            extensions={[cpp(), highlightField]}
            readOnly={isTyping}
            onChange={(value) => {
              setCode(value);
              setActivePulseId(null);
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
            <button 
              className="btn btn-copy" 
              onClick={(e) => {
                navigator.clipboard.writeText(logs.map(l => l.text).join('\\n'));
                const btn = e.currentTarget;
                const originalText = btn.innerHTML;
                btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #4ade80"><path d="M20 6 9 17l-5-5"/></svg> Kopiert!';
                btn.style.color = '#4ade80';
                setTimeout(() => {
                  btn.innerHTML = originalText;
                  btn.style.color = '';
                }, 2000);
              }}
              title="Konsolenausgabe kopieren"
            >
              <Copy size={14} /> Kopieren
            </button>
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
          <h3 style={{ fontSize: '16px', color: '#6366F1', margin: 0, textShadow: '0 0 10px rgba(99, 102, 241, 0.3)', marginBottom: '16px' }}>KI Hilfe</h3>
          <div className="chat-messages" style={{ flex: 1, background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '16px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="info" style={{ marginBottom: '16px', lineHeight: '1.5' }}>
              Hallo! Wie kann ich dir heute beim Programmieren helfen? Ich sehe deinen C++ Code und deine Fehler automatisch.
            </div>
            
            {chatHistory.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '16px' }}>
                <button 
                  onClick={() => handleSendChat("Wie fange ich an?")}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', fontSize: '13px', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                >
                  🚀 Wie fange ich an?
                </button>
                <button 
                  onClick={() => handleSendChat("Was sind die wichtigsten Befehle?")}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', fontSize: '13px', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                >
                  💡 Was sind die wichtigsten Befehle?
                </button>
                <button 
                  onClick={() => handleSendChat("Erkläre mir den aktuellen Code.")}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', fontSize: '13px', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                >
                  📖 Erkläre mir den aktuellen Code.
                </button>
                <button 
                  onClick={() => handleSendChat("Warum funktioniert mein Code nicht?")}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', fontSize: '13px', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                >
                  🐞 Warum funktioniert mein Code nicht?
                </button>
                <button 
                  onClick={() => handleSendChat("Was könnte man an meinem Code verbessern?")}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', padding: '10px 16px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', fontSize: '13px', transition: 'background 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                >
                  ✨ Was könnte man an meinem Code verbessern?
                </button>
              </div>
            )}

            {chatHistory.map((msg, idx) => (
              <div key={msg.id || idx} className={msg.id === activePulseId ? 'automated-feedback-pulse' : ''} style={{ 
                marginBottom: '12px', 
                padding: '10px 14px', 
                borderRadius: '12px',
                background: msg.role === 'user' ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                border: msg.role === 'user' ? '1px solid rgba(99, 102, 241, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                color: msg.role === 'user' ? '#e0e7ff' : '#cbd5e1',
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                whiteSpace: 'pre-wrap',
                fontFamily: msg.role === 'model' ? 'Inter, sans-serif' : 'inherit',
                transition: 'all 0.3s'
              }}>
                <strong style={{ display: 'block', marginBottom: '4px', color: msg.role === 'user' ? '#818cf8' : (msg.isAutomatedFeedback ? '#ef4444' : '#38bdf8'), fontSize: '12px' }}>
                  {msg.role === 'user' ? 'Du' : (msg.isAutomatedFeedback ? 'KI Assistent (Tipp)' : 'KI Assistent')}
                </strong>
                {msg.text}
              </div>
            ))}
            {isTyping && (
              <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '13px' }}>KI tippt...</div>
            )}
            <div ref={chatMessagesEndRef} />
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
            <button className="btn btn-primary btn-pill" onClick={() => handleSendChat()} disabled={isTyping}>Senden</button>
          </div>
        </div>
      </div>

      <div className="right-panel">
        <div className="floating-panel simulator-panel">
          <div className="control-panel">
            {!isRunning ? (
              <button className="btn btn-primary" onClick={handleRun} disabled={isTyping} title={isTyping ? "Warte auf KI..." : ""}><Play size={16} /> Code ausführen</button>
            ) : (
              <button className="btn btn-danger" onClick={handleStop}><Square size={16} /> Ausführung stoppen</button>
            )}
          </div>

          <div className="calliope-board-wrapper">
            <div className="calliope-board">
              <img src={`${import.meta.env.BASE_URL}calliope_clean.png`} alt="Calliope Board" className="calliope-bg" onError={(e) => e.currentTarget.style.display = 'none'} />

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
              <div className="pin pin-0" title="Pin 0"><span className="pin-label label-right">0</span></div>
              <div className="pin pin-1" title="Pin 1"><span className="pin-label label-top-right">1</span></div>
              <div className="pin pin-2" title="Pin 2"><span className="pin-label label-top-left">2</span></div>
              <div className="pin pin-3" title="Pin 3"><span className="pin-label label-left">3</span></div>
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
