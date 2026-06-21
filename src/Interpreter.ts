// @ts-nocheck
import { font } from './font';
const Parser = (window as any).TreeSitter;
type SyntaxNode = any;
import type { CalliopeState } from './CalliopeState';

// A simple interface for interacting with the React state from the interpreter
export interface CalliopeAPI {
  getState: () => CalliopeState;
  setState: (state: Partial<CalliopeState>) => void;
  getButtonA: () => boolean;
  getButtonB: () => boolean;
  sleep: (ms: number) => Promise<void>;
  log: (msg: string, type?: 'info' | 'error' | 'success') => void;
  // This helps us abort execution if the user clicks "stop"
  checkAbort: () => void;
}

export class CalliopeInterpreter {
  private parser: Parser | null = null;
  private api: CalliopeAPI;
  public isRunning = false;
  private currentExecutionId = 0;

  // Variables scope (global for simplicity as Open Roberta often uses global vars or simple main scope)
  private variables: Record<string, any> = {};

  constructor(api: CalliopeAPI) {
    this.api = api;
  }

  public async init() {
    await Parser.init({
      locateFile(scriptName: string, scriptDirectory: string) {
        return import.meta.env.BASE_URL + scriptName;
      },
    });
    this.parser = new Parser();
    const cppLang = await Parser.Language.load(import.meta.env.BASE_URL + 'tree-sitter-cpp.wasm');
    this.parser.setLanguage(cppLang);
  }

  public stop() {
    this.currentExecutionId++;
    if (this.isRunning) {
      this.api.log("Ausführung durch Benutzer gestoppt.", "info");
    }
    this.isRunning = false;
  }

  public async execute(code: string): Promise<boolean> {
    if (!this.parser) {
      this.api.log("Parser ist noch nicht initialisiert.", "error");
      return false;
    }

    const execId = ++this.currentExecutionId;
    this.isRunning = true;
    this.variables = {}; // reset variables

    const tree = this.parser.parse(code);
    
    // Quick check for syntax errors
    if (tree.rootNode.hasError()) {
      this.api.log("Syntaxfehler im C++ Code.", "error");
      this.printErrors(tree.rootNode);
      this.isRunning = false;
      return false;
    }

    // Validate AST for unknown functions
    const validationErrors: string[] = [];
    this.validateAST(tree.rootNode, validationErrors);
    if (validationErrors.length > 0) {
      validationErrors.forEach(err => this.api.log(err, "error"));
      this.isRunning = false;
      return false;
    }

    this.api.log("Kompilierung & Validierung erfolgreich. Führe aus...", "success");

    let executionSuccess = true;
    try {
      // Find the main function
      const mainFunc = this.findMainFunction(tree.rootNode);
      if (mainFunc) {
        // Execute the body of the main function
        const body = mainFunc.childForFieldName('body');
        if (body && body.type === 'compound_statement') {
          await this.walkCompoundStatement(body, execId);
        }
      } else {
        this.api.log("Keine main-Funktion gefunden.", "error");
        executionSuccess = false;
      }
    } catch (e: any) {
      if (e.message !== 'ABORTED') {
        this.api.log(`Laufzeitfehler: ${e.message}`, "error");
        executionSuccess = false;
      }
    } finally {
      this.isRunning = false;
    }
    
    return executionSuccess;
  }

  private printErrors(node: SyntaxNode) {
    if (node.type === 'ERROR' || node.isMissing()) {
      this.api.log(`Syntaxfehler in Zeile ${node.startPosition.row + 1}, Spalte ${node.startPosition.column}: '${node.text}'`, 'error');
    }
    for (let child of node.children) {
      this.printErrors(child);
    }
  }

  private validateAST(node: SyntaxNode, errors: string[]) {
    if (node.type === 'call_expression') {
      const funcName = node.childForFieldName('function')?.text;
      
      if (funcName) {
        const allowed = [
          '_uBit.display.scroll',
          '_uBit.display.print',
          '_uBit.display.clear',
          '_uBit.rgb.setColour',
          '_uBit.rgb.off',
          '_uBit.buttonA.isPressed',
          '_uBit.buttonB.isPressed',
          'release_fiber',
          '_uBit.init',
          '_uBit.sleep',
          'MicroBitColor'
        ];
        
        const isAllowed = allowed.some(name => funcName === name || funcName.startsWith(name));
        if (!isAllowed) {
          errors.push(`Validierungsfehler: Unbekannte Funktion oder Tippfehler '${funcName}' in Zeile ${node.startPosition.row + 1}`);
        }
      }
    }

    for (let child of node.children) {
      this.validateAST(child, errors);
    }
  }

  private findMainFunction(root: SyntaxNode): SyntaxNode | null {
    for (const child of root.namedChildren) {
      if (child.type === 'function_definition') {
        const declarator = child.childForFieldName('declarator');
        if (declarator) {
          // It could be a function_declarator
          let nameNode = declarator.childForFieldName('declarator');
          if (nameNode && nameNode.text === 'main') {
            return child;
          }
        }
      }
    }
    return null;
  }

  private async walkCompoundStatement(node: SyntaxNode, execId: number) {
    for (const child of node.namedChildren) {
      if (this.currentExecutionId !== execId) throw new Error('ABORTED');
      this.api.checkAbort();
      await this.walkStatement(child, execId);
    }
  }

  private async walkStatement(node: SyntaxNode, execId: number) {
    if (this.currentExecutionId !== execId) throw new Error('ABORTED');
    
    switch (node.type) {
      case 'expression_statement':
        await this.walkExpression(node.namedChildren[0], execId);
        break;
      case 'if_statement':
        await this.walkIfStatement(node, execId);
        break;
      case 'while_statement':
        await this.walkWhileStatement(node, execId);
        break;
      case 'for_statement':
        // basic support
        break;
      case 'declaration':
        this.walkDeclaration(node);
        break;
    }
  }

  private walkDeclaration(node: SyntaxNode) {
    // Basic declaration support: int x = 5;
    // We only care about variables the user defines, which might be in the Open Roberta output.
    const declarator = node.childForFieldName('declarator');
    if (declarator && declarator.type === 'init_declarator') {
      const name = declarator.childForFieldName('declarator')?.text;
      const valueNode = declarator.childForFieldName('value');
      if (name && valueNode) {
        const val = this.evaluateExpression(valueNode);
        this.variables[name] = val;
        this.api.setState({ variables: { ...this.variables } });
      }
    }
  }

  private async walkIfStatement(node: SyntaxNode, execId: number) {
    const conditionNode = node.childForFieldName('condition');
    const consequence = node.childForFieldName('consequence');
    const alternative = node.childForFieldName('alternative');

    if (conditionNode && consequence) {
      // Evaluate condition
      const condValue = this.evaluateExpression(conditionNode.namedChildren[0]);
      if (condValue) {
        if (consequence.type === 'compound_statement') {
          await this.walkCompoundStatement(consequence, execId);
        } else {
          await this.walkStatement(consequence, execId);
        }
      } else if (alternative) {
        const altBody = alternative.namedChildren[0]; // either an if_statement or compound_statement
        if (altBody.type === 'compound_statement') {
          await this.walkCompoundStatement(altBody, execId);
        } else {
          await this.walkStatement(altBody, execId);
        }
      }
    }
  }

  private async walkWhileStatement(node: SyntaxNode, execId: number) {
    const conditionNode = node.childForFieldName('condition');
    const body = node.childForFieldName('body');

    if (conditionNode && body) {
      // Small protection against infinite loops hanging the browser
      let maxIters = 10000;
      while (this.evaluateExpression(conditionNode.namedChildren[0]) && maxIters-- > 0) {
        if (this.currentExecutionId !== execId) throw new Error('ABORTED');
        if (body.type === 'compound_statement') {
          await this.walkCompoundStatement(body, execId);
        } else {
          await this.walkStatement(body, execId);
        }
        await this.api.sleep(1); // 1ms tick speed
      }
    }
  }

  private async walkExpression(node: SyntaxNode, execId: number): Promise<any> {
    if (!node) return;
    
    // Call expressions like _uBit.display.scroll("Hello")
    if (node.type === 'call_expression') {
      const functionNode = node.childForFieldName('function');
      const argumentsNode = node.childForFieldName('arguments');
      
      const funcName = functionNode?.text;
      const args = argumentsNode?.namedChildren.map(arg => this.evaluateExpression(arg)) || [];

      // Open Roberta specific maps
      if (funcName?.startsWith('_uBit.display.scroll')) {
        await this.simulateDisplayScroll(args[0], execId);
      } 
      else if (funcName?.startsWith('_uBit.display.print')) {
        await this.simulateDisplayPrint(args[0]);
      }
      else if (funcName?.startsWith('_uBit.display.clear')) {
        this.api.setState({ ledMatrix: Array(5).fill(Array(5).fill(0)) });
      }
      else if (funcName?.startsWith('_uBit.rgb.setColour')) {
        // e.g. MicroBitColor(255, 0, 0, 255) -> parsed via evaluateExpression if it's a nested call, or we just extract text.
        // Actually Open Roberta might do _uBit.rgb.setColour(MicroBitColor(255, 0, 0, 255));
        // We will intercept this specifically.
        if (argumentsNode && argumentsNode.text.includes('MicroBitColor')) {
          const colorArgsMatch = argumentsNode.text.match(/MicroBitColor\((.*?)\)/);
          if (colorArgsMatch) {
            const colorVals = colorArgsMatch[1].split(',').map(s => parseInt(s.trim()));
            this.api.setState({ rgbLed: [colorVals[0], colorVals[1], colorVals[2]] });
          }
        }
      }
      else if (funcName?.startsWith('_uBit.rgb.off')) {
        this.api.setState({ rgbLed: [0, 0, 0] });
      }
      else if (funcName === 'release_fiber' || funcName === '_uBit.init') {
        // Ignore, boilerplate
      }
      else if (funcName === '_uBit.sleep') {
        await this.api.sleep(args[0] || 100);
      }
      else {
        throw new Error(`Unknown function or typo: ${funcName}`);
      }
      
      return;
    }

    return this.evaluateExpression(node);
  }

  private evaluateExpression(node: SyntaxNode): any {
    if (!node) return null;

    if (node.type === 'number_literal') {
      return Number(node.text);
    }
    if (node.type === 'string_literal') {
      // Remove quotes
      return node.text.replace(/^"|"$/g, '');
    }
    if (node.type === 'true') return true;
    if (node.type === 'false') return false;
    if (node.type === 'identifier') {
      if (this.variables[node.text] !== undefined) {
        return this.variables[node.text];
      }
      throw new Error(`Variable '${node.text}' is not defined`);
    }

    if (node.type === 'assignment_expression') {
      const leftNode = node.childForFieldName('left');
      const rightNode = node.childForFieldName('right');
      if (leftNode && rightNode && leftNode.type === 'identifier') {
        const val = this.evaluateExpression(rightNode);
        this.variables[leftNode.text] = val;
        this.api.setState({ variables: { ...this.variables } });
        return val;
      }
    }

    if (node.type === 'binary_expression') {
      const left = this.evaluateExpression(node.childForFieldName('left') as SyntaxNode);
      const right = this.evaluateExpression(node.childForFieldName('right') as SyntaxNode);
      const operator = node.childForFieldName('operator')?.text;

      switch(operator) {
        case '==': return left === right;
        case '!=': return left !== right;
        case '<': return left < right;
        case '<=': return left <= right;
        case '>': return left > right;
        case '>=': return left >= right;
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return left / right;
      }
    }

    if (node.type === 'call_expression') {
      const funcName = node.childForFieldName('function')?.text;
      if (funcName === '_uBit.buttonA.isPressed') return this.api.getButtonA();
      if (funcName === '_uBit.buttonB.isPressed') return this.api.getButtonB();
    }

    return null;
  }



// Visual simulation helpers
  private async simulateDisplayScroll(text: string, execId: number) {
    const chars = String(text).toUpperCase().split('');
    const paddedCols: number[][] = [];
    
    // 5 empty cols to start
    for (let i = 0; i < 5; i++) paddedCols.push([0,0,0,0,0]);
    
    for (const char of chars) {
      const charMatrix = font[char] || font[' '];
      for (let x = 0; x < 5; x++) {
        paddedCols.push([charMatrix[0][x], charMatrix[1][x], charMatrix[2][x], charMatrix[3][x], charMatrix[4][x]]);
      }
      // 1 empty col between chars
      paddedCols.push([0,0,0,0,0]);
    }
    
    // 5 empty cols to end
    for (let i = 0; i < 4; i++) paddedCols.push([0,0,0,0,0]);
    
    for (let offset = 0; offset <= paddedCols.length - 5; offset++) {
      if (this.currentExecutionId !== execId) throw new Error('ABORTED');
      
      const matrix = Array(5).fill(Array(5).fill(0)).map(row => [...row]);
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          matrix[y][x] = paddedCols[offset + x][y];
        }
      }
      this.api.setState({ ledMatrix: matrix });
      await this.api.sleep(150); // 150ms per shift
    }
  }

  private async simulateDisplayPrint(char: string) {
    const c = String(char).toUpperCase().charAt(0);
    const charMatrix = font[c] || font[' '];
    const matrix = Array(5).fill(Array(5).fill(0)).map(row => [...row]);
    
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        matrix[y][x] = charMatrix[y][x];
      }
    }
    
    this.api.setState({ ledMatrix: matrix });
    await this.api.sleep(400); // Standard microbit print time (400ms)
  }
}
