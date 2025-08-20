#!/usr/bin/env node

import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

console.log('Echo REPL - Type your message and I\'ll echo it back with excitement!');
console.log('Type "exit" or press Ctrl+C to quit\n');

rl.prompt();

rl.on('line', (input: string) => {
  const trimmedInput = input.trim();
  
  if (trimmedInput.toLowerCase() === 'exit') {
    console.log('Goodbye!');
    rl.close();
    process.exit(0);
  }
  
  if (trimmedInput) {
    console.log(`${trimmedInput}!`);
  }
  
  rl.prompt();
});

rl.on('close', () => {
  console.log('\nGoodbye!');
  process.exit(0);
});