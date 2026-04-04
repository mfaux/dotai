import type { ContextType } from '../lib/types.ts';
import { consumeMultiValues } from '../cli-parse.ts';

export interface AddOptions {
  global?: boolean;
  /** Install targets — resolves to skill agents or transpilation targets depending on content type. */
  targets?: string[];
  yes?: boolean;
  skill?: string[];
  prompt?: string[];
  customAgent?: string[];
  instruction?: string[];
  all?: boolean;
  fullDepth?: boolean;
  copy?: boolean;
  dryRun?: boolean;
  force?: boolean;
  /** Add transpiled output paths to .gitignore (opt-in). */
  gitignore?: boolean;
  /** Filter discovery to specific context types (skill, prompt, agent, instruction). */
  type?: ContextType[];
}

// Parse command line options from args array
export function parseAddOptions(args: string[]): { source: string[]; options: AddOptions } {
  const options: AddOptions = {};
  const source: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '-a' || arg === '--targets') {
      options.targets = options.targets || [];
      const { values, nextIndex } = consumeMultiValues(args, i + 1, { splitCommas: true });
      options.targets.push(...values);
      i = nextIndex - 1; // Back up one since the loop will increment
    } else if (arg === '-s' || arg === '--skill') {
      options.skill = options.skill || [];
      const { values, nextIndex } = consumeMultiValues(args, i + 1);
      options.skill.push(...values);
      i = nextIndex - 1;
    } else if (arg === '-p' || arg === '--prompt') {
      options.prompt = options.prompt || [];
      const { values, nextIndex } = consumeMultiValues(args, i + 1);
      options.prompt.push(...values);
      i = nextIndex - 1;
    } else if (arg === '--custom-agent') {
      options.customAgent = options.customAgent || [];
      const { values, nextIndex } = consumeMultiValues(args, i + 1);
      options.customAgent.push(...values);
      i = nextIndex - 1;
    } else if (arg === '-i' || arg === '--instruction') {
      options.instruction = options.instruction || [];
      const { values, nextIndex } = consumeMultiValues(args, i + 1);
      options.instruction.push(...values);
      i = nextIndex - 1;
    } else if (arg === '--gitignore') {
      options.gitignore = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--full-depth') {
      options.fullDepth = true;
    } else if (arg === '--copy') {
      options.copy = true;
    } else if (arg === '-t' || arg === '--type') {
      options.type = options.type || [];
      const { values, nextIndex } = consumeMultiValues(args, i + 1, { splitCommas: true });
      for (const val of values) {
        const lower = val.toLowerCase();
        if (!options.type.includes(lower as ContextType)) {
          options.type.push(lower as ContextType);
        }
      }
      i = nextIndex - 1;
    } else if (arg && !arg.startsWith('-')) {
      source.push(arg);
    }
  }

  return { source, options };
}
