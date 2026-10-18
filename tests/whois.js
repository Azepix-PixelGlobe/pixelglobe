import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import whois from '../src/utils/intel/whois.js';

async function doit() {
  const rl = readline.createInterface({ input, output });
  while (true) {
    const ip = await rl.question('Input IP: ');
    const res = await whois(ip);
    console.log(res);
  }
  rl.close();
}

doit();
