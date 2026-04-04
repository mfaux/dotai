export {
  agents,
  detectInstalledAgents,
  getUniversalAgents,
  getNonUniversalAgents,
  isUniversalAgent,
} from './agents.ts';

export type {
  ContextTypeConfig,
  InstructionsConfig,
  NativePromptDiscovery,
  NativeAgentDiscovery,
  TargetAgentConfig,
} from './target-agents.ts';

export {
  targetAgents,
  TARGET_AGENTS,
  getTargetAgentConfig,
  getOutputDir,
  getPromptExtension,
  getAgentExtension,
} from './target-agents.ts';
