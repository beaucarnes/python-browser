const terminalContainer = document.getElementById('terminal');
const codeInput = document.getElementById('code-input');
const runButton = document.getElementById('run-btn');

const term = new Terminal();
const fitAddon = new FitAddon.FitAddon();

term.loadAddon(fitAddon);
term.open(terminalContainer);
fitAddon.fit();

let pyodide;

const initPyodide = async () => {
  pyodide = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.23.2/full/' });
};

initPyodide().then(() => {
  term.writeln('Pyodide initialized');
});

function print(...args) {
  const text = args.map(arg => {
    if (typeof arg === 'object' && arg.__str__) {
      return arg.__str__();
    } else {
      return arg;
    }
  }).join(' ');
  term.writeln(`>>> ${text}`);
}


function sleep(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}

const createInputFunction = () => {
  return async function input(text) {
    return new Promise((resolve) => {
      let userinput = "";
      term.writeln(`>>> ${text}`);

      const keyListener = (data) => {
        const key = data;
        if (key === '\u007F' || key === '\b') { // Backspace or delete key
          term.write('\b \b'); // Move cursor back, replace character with space, then move cursor back again
          userinput = userinput.slice(0, -1); // Remove the last character from userinput
        } else {
          userinput += key;
          term.write(key);
        }

        if (key == '\r') {
          term.write('\n');
          disposable.dispose(); // Stop listening for key events
          userinput = userinput.slice(0, -1); 
          resolve(userinput);
        }
      };

      const disposable = term.onData(keyListener);
      activeDisposables.push(disposable); // Add disposable to the list of active disposables
    });
  };
};

function modifyInputStatements(line) {
  // Use a regular expression to match input statements with chained methods
  const inputRegex = /(.*=\s*)input\((["'].*?["']\))(\.\w+\([^)]*\))*/;
  const match = line.match(inputRegex);
  if (match) {
    console.log(match)
    const inputStatement = match[0];
    const varAssignment = match[1];
    const inputCall = 'input' + inputStatement.slice(varAssignment.length).split('input')[1].split('.')[0];
    const methods = inputStatement.slice(varAssignment.length + inputCall.length).split('.').slice(1);
    const tempVar = '_temp_input_var';
    const newStatements = [
      `${tempVar} = ${inputCall}`,
      ...methods.map(method => `${tempVar} = ${tempVar}.${method}`),
      `${varAssignment.trim()} ${tempVar}`
    ];
    // Get the indentation of the original line
    const indentation = line.match(/^\s*/)[0];
    // Apply the same indentation to each new statement
    const indentedStatements = newStatements.map(stmt => indentation + stmt);
    // Replace the original input statement in the line with the temporary variable
    const updatedLine = line.replace(inputStatement, indentedStatements.join('\n'));
    return updatedLine.split('\n');
  }
  return [line];
}



// List to store active key listener disposables
const activeDisposables = [];

runButton.addEventListener('click', async () => {
  term.focus();
  // Dispose of all active key listeners
  activeDisposables.forEach((disposable) => {
    disposable.dispose();
  });

  // Clear the list of active disposables
  activeDisposables.length = 0;

  // Reset the terminal
  term.reset();

  // Create a new input function
  window.input = createInputFunction();

  const code = codeInput.value;

  const lines = code.split('\n');
  const asyncFunctions = new Set();
  const modifiedLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Modify input statements with chained methods
    const updatedLines = modifyInputStatements(line);

    // If the line contains an input statement, update it to use "await"
    if (updatedLines.some(updatedLine => updatedLine.includes('input('))) {
      updatedLines.forEach((updatedLine, index) => {
        if (updatedLine.includes('input(')) {
          updatedLines[index] = updatedLine.replace('input(', 'await input(');
        }
      });

      // Find the outer function definition and make it async
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].includes('def ')) {
          if (!modifiedLines[j].includes('async def ')) {
            const functionName = lines[j].match(/def\s+([a-zA-Z_][a-zA-Z_0-9]*)/)[1];
            asyncFunctions.add(functionName);
            modifiedLines[j] = modifiedLines[j].replace('def ', 'async def ');
          }
          break;
        }
      }
    }

    // Update function calls to include 'await' for async functions
    asyncFunctions.forEach(funcName => {
      updatedLines.forEach((updatedLine, index) => {
        if (updatedLine.includes(` ${funcName}(`) && !updatedLine.includes(`await ${funcName}(`)) {
          updatedLines[index] = updatedLine.replace(`${funcName}(`, `await ${funcName}(`);
        }
      });
    });

    modifiedLines.push(...updatedLines);
  }
  
  
  const modifiedCode = `
import js
from js import sleep
from js import print
from js import input
` + modifiedLines.join('\n');
  
  console.log(modifiedCode)
  try {
    await pyodide.runPythonAsync(modifiedCode);
  } catch (error) {
    term.writeln(`Error: ${error.message}`);
  }
});

