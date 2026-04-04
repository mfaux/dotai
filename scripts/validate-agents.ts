#!/usr/bin/env node

import { agents } from '../src/lib/agents/agents.ts';

let hasErrors = false;

function error(message: string) {
  console.error(message);
  hasErrors = true;
}

/**
 * Checks for duplicate `displayName` values among the agents.
 *
 * Iterates through the `agents` object, collecting all `displayName` values (case-insensitive)
 * and mapping them to their corresponding agent keys. If any `displayName` is associated with
 * more than one agent, an error is reported listing the duplicate names and their keys.
 *
 * @throws Will call the `error` function if duplicate display names are found.
 */

function checkDuplicateDisplayNames() {
  const displayNames = new Map<string, string[]>();

  for (const [key, config] of Object.entries(agents)) {
    const name = config.displayName.toLowerCase();
    if (!displayNames.has(name)) {
      displayNames.set(name, []);
    }
    displayNames.get(name)!.push(key);
  }

  for (const [name, keys] of displayNames) {
    if (keys.length > 1) {
      error(`Duplicate displayName "${name}" found in agents: ${keys.join(', ')}`);
    }
  }
}

console.log('Validating agents...\n');

checkDuplicateDisplayNames();

if (hasErrors) {
  console.log('\nValidation failed.');
  process.exit(1);
} else {
  console.log('All agents valid.');
}
