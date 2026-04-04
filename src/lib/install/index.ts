export {
  type InstallPipelineOptions,
  type PipelineWrite,
  type InstallPipelineResult,
  planContextWrites,
  executeInstallPipeline,
} from './context-installer.ts';

export {
  resolveTargetAgents,
  type PromptAddOptions,
  type PromptAddResult,
  addPrompts,
  type AgentAddOptions,
  type AgentAddResult,
  addAgents,
  type InstructionAddOptions,
  type InstructionAddResult,
  addInstructions,
} from './context-add.ts';

export {
  type RuleUpdate,
  type RuleCheckError,
  type ContextCheckResult,
  type ContextUpdateResult,
  checkContextUpdates,
  updateContext,
} from './context-check.ts';

export {
  type InstallMode,
  sanitizeName,
  getCanonicalSkillsDir,
  installSkillForAgent,
  isSkillInstalled,
  getInstallPath,
  getCanonicalPath,
  installRemoteSkillForAgent,
  installWellKnownSkillForAgent,
  type InstalledSkill,
  listInstalledSkills,
} from './skill-installer.ts';

export {
  type CheckCollisionOptions,
  createPlannedWrite,
  checkCollisions,
  filterBlockingCollisions,
  formatCollision,
} from './collisions.ts';

export { upsertSection, removeSection, hasSection, extractSection } from './append-markers.ts';
