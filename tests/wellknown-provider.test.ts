import { describe, it, expect } from 'vitest';
import { WellKnownProvider, isValidSkillEntry } from '../src/providers/wellknown.ts';

describe('WellKnownProvider', () => {
  const provider = new WellKnownProvider();

  describe('match', () => {
    it('should match arbitrary HTTP URLs', () => {
      expect(provider.match('https://example.com').matches).toBe(true);
      expect(provider.match('https://docs.example.com/skills').matches).toBe(true);
      expect(provider.match('http://localhost:3000').matches).toBe(true);
    });

    it('should match URLs with paths', () => {
      expect(provider.match('https://mintlify.com/docs').matches).toBe(true);
      expect(provider.match('https://example.com/api/v1').matches).toBe(true);
    });

    it('should not match GitHub URLs', () => {
      expect(provider.match('https://github.com/owner/repo').matches).toBe(false);
    });

    it('should not match GitLab URLs', () => {
      expect(provider.match('https://gitlab.com/owner/repo').matches).toBe(false);
    });

    it('should not match HuggingFace URLs', () => {
      expect(provider.match('https://huggingface.co/spaces/owner/repo').matches).toBe(false);
    });

    it('should not match non-HTTP URLs', () => {
      expect(provider.match('git@github.com:owner/repo.git').matches).toBe(false);
      expect(provider.match('ssh://git@example.com/repo').matches).toBe(false);
      expect(provider.match('/local/path').matches).toBe(false);
    });
  });

  describe('getSourceIdentifier', () => {
    it('should return full hostname', () => {
      expect(provider.getSourceIdentifier('https://example.com')).toBe('example.com');
      expect(provider.getSourceIdentifier('https://mintlify.com')).toBe('mintlify.com');
      expect(provider.getSourceIdentifier('https://lovable.dev')).toBe('lovable.dev');
    });

    it('should return same identifier regardless of path', () => {
      expect(provider.getSourceIdentifier('https://example.com/docs')).toBe('example.com');
      expect(provider.getSourceIdentifier('https://example.com/api/v1')).toBe('example.com');
    });

    it('should preserve subdomains', () => {
      expect(provider.getSourceIdentifier('https://docs.example.com')).toBe('docs.example.com');
      expect(provider.getSourceIdentifier('https://api.mintlify.com/docs')).toBe(
        'api.mintlify.com'
      );
      expect(provider.getSourceIdentifier('https://mppx-discovery-skills.vercel.app')).toBe(
        'mppx-discovery-skills.vercel.app'
      );
    });

    it('should strip www. prefix', () => {
      expect(provider.getSourceIdentifier('https://www.example.com')).toBe('example.com');
      expect(provider.getSourceIdentifier('https://www.mintlify.com/docs')).toBe('mintlify.com');
    });

    it('should return unknown for invalid URLs', () => {
      expect(provider.getSourceIdentifier('not-a-url')).toBe('unknown');
    });
  });

  describe('toRawUrl', () => {
    it('should return index.json URL for base URLs', () => {
      const result = provider.toRawUrl('https://example.com');
      expect(result).toBe('https://example.com/.well-known/skills/index.json');
    });

    it('should return index.json URL with path', () => {
      const result = provider.toRawUrl('https://example.com/docs');
      expect(result).toBe('https://example.com/docs/.well-known/skills/index.json');
    });

    it('should return SKILL.md URL if already pointing to skill.md', () => {
      const url = 'https://example.com/.well-known/skills/my-skill/SKILL.md';
      expect(provider.toRawUrl(url)).toBe(url);
    });
  });

  describe('isValidSkillEntry (via fetchIndex validation)', () => {
    // Since isValidSkillEntry is private, we test it indirectly through the provider's behavior

    it('provider should have id "well-known"', () => {
      expect(provider.id).toBe('well-known');
    });

    it('provider should have display name "Well-Known Skills"', () => {
      expect(provider.displayName).toBe('Well-Known Skills');
    });
  });

  describe('isValidSkillEntry', () => {
    const validEntry = {
      name: 'my-skill',
      description: 'A test skill',
      files: ['SKILL.md'],
    };

    it('should accept valid multi-char names', () => {
      expect(isValidSkillEntry(validEntry)).toBe(true);
      expect(isValidSkillEntry({ ...validEntry, name: 'abc' })).toBe(true);
      expect(isValidSkillEntry({ ...validEntry, name: 'my-long-skill-name' })).toBe(true);
      expect(isValidSkillEntry({ ...validEntry, name: 'a1b2c3' })).toBe(true);
    });

    it('should accept valid single-char names', () => {
      expect(isValidSkillEntry({ ...validEntry, name: 'a' })).toBe(true);
      expect(isValidSkillEntry({ ...validEntry, name: '0' })).toBe(true);
      expect(isValidSkillEntry({ ...validEntry, name: 'z' })).toBe(true);
      expect(isValidSkillEntry({ ...validEntry, name: '9' })).toBe(true);
    });

    it('should reject uppercase single-char names', () => {
      expect(isValidSkillEntry({ ...validEntry, name: 'A' })).toBe(false);
      expect(isValidSkillEntry({ ...validEntry, name: 'Z' })).toBe(false);
    });

    it('should reject invalid single-char names', () => {
      expect(isValidSkillEntry({ ...validEntry, name: '-' })).toBe(false);
      expect(isValidSkillEntry({ ...validEntry, name: '_' })).toBe(false);
      expect(isValidSkillEntry({ ...validEntry, name: '!' })).toBe(false);
    });

    it('should reject names with uppercase letters', () => {
      expect(isValidSkillEntry({ ...validEntry, name: 'MySkill' })).toBe(false);
      expect(isValidSkillEntry({ ...validEntry, name: 'SKILL' })).toBe(false);
    });

    it('should reject names starting or ending with hyphens', () => {
      expect(isValidSkillEntry({ ...validEntry, name: '-my-skill' })).toBe(false);
      expect(isValidSkillEntry({ ...validEntry, name: 'my-skill-' })).toBe(false);
    });

    it('should reject names with invalid characters', () => {
      expect(isValidSkillEntry({ ...validEntry, name: 'my_skill' })).toBe(false);
      expect(isValidSkillEntry({ ...validEntry, name: 'my skill' })).toBe(false);
      expect(isValidSkillEntry({ ...validEntry, name: 'my.skill' })).toBe(false);
    });

    it('should reject empty name', () => {
      expect(isValidSkillEntry({ ...validEntry, name: '' })).toBe(false);
    });

    it('should reject non-object entries', () => {
      expect(isValidSkillEntry(null)).toBe(false);
      expect(isValidSkillEntry(undefined)).toBe(false);
      expect(isValidSkillEntry('string')).toBe(false);
      expect(isValidSkillEntry(42)).toBe(false);
    });

    it('should reject entries missing required fields', () => {
      expect(isValidSkillEntry({ name: 'test', description: 'desc' })).toBe(false); // no files
      expect(isValidSkillEntry({ name: 'test', files: ['SKILL.md'] })).toBe(false); // no description
      expect(isValidSkillEntry({ description: 'desc', files: ['SKILL.md'] })).toBe(false); // no name
    });

    it('should reject entries with empty files array', () => {
      expect(isValidSkillEntry({ ...validEntry, files: [] })).toBe(false);
    });

    it('should reject entries without SKILL.md', () => {
      expect(isValidSkillEntry({ ...validEntry, files: ['README.md'] })).toBe(false);
    });

    it('should reject files with path traversal', () => {
      expect(isValidSkillEntry({ ...validEntry, files: ['SKILL.md', '../etc/passwd'] })).toBe(
        false
      );
      expect(isValidSkillEntry({ ...validEntry, files: ['SKILL.md', '/etc/passwd'] })).toBe(false);
      expect(isValidSkillEntry({ ...validEntry, files: ['SKILL.md', '\\windows\\file'] })).toBe(
        false
      );
    });
  });
});

describe('parseSource with well-known URLs', async () => {
  // Import parseSource after provider is defined
  const { parseSource } = await import('../src/lib/parsers/source-parser.ts');

  it('should parse arbitrary URL as well-known type', () => {
    const result = parseSource('https://example.com');
    expect(result.type).toBe('well-known');
    expect(result.url).toBe('https://example.com');
  });

  it('should parse URL with path as well-known type', () => {
    const result = parseSource('https://mintlify.com/docs');
    expect(result.type).toBe('well-known');
    expect(result.url).toBe('https://mintlify.com/docs');
  });

  it('should not parse GitHub URL as well-known', () => {
    const result = parseSource('https://github.com/owner/repo');
    expect(result.type).toBe('github');
  });

  it('should not parse .git URL as well-known', () => {
    const result = parseSource('https://git.example.com/owner/repo.git');
    expect(result.type).toBe('git');
  });

  it('should parse direct skill.md URL as well-known (no more direct-url type)', () => {
    const result = parseSource('https://docs.example.com/skill.md');
    expect(result.type).toBe('well-known');
  });
});
