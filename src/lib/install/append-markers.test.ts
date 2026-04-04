import { describe, it, expect } from 'vitest';
import { upsertSection, removeSection, hasSection, extractSection } from './append-markers.ts';

// ---------------------------------------------------------------------------
// upsertSection
// ---------------------------------------------------------------------------

describe('upsertSection', () => {
  it('appends section to empty content', () => {
    const result = upsertSection('', 'code-style', 'Use const over let.');

    expect(result).toBe(
      [
        '<!-- dotai:code-style:start -->',
        'Use const over let.',
        '<!-- dotai:code-style:end -->',
        '',
      ].join('\n')
    );
  });

  it('appends section to existing content', () => {
    const existing = '# My Project\n\nSome existing content.\n';
    const result = upsertSection(existing, 'code-style', 'Use const over let.');

    expect(result).toContain('# My Project');
    expect(result).toContain('Some existing content.');
    expect(result).toContain('<!-- dotai:code-style:start -->');
    expect(result).toContain('Use const over let.');
    expect(result).toContain('<!-- dotai:code-style:end -->');
    expect(result.endsWith('\n')).toBe(true);
  });

  it('preserves blank line between existing content and new section', () => {
    const existing = '# My Project\n';
    const result = upsertSection(existing, 'security', 'Validate all inputs.');

    expect(result).toBe(
      [
        '# My Project',
        '',
        '<!-- dotai:security:start -->',
        'Validate all inputs.',
        '<!-- dotai:security:end -->',
        '',
      ].join('\n')
    );
  });

  it('replaces content between existing markers', () => {
    const existing = [
      '# My Project',
      '',
      '<!-- dotai:code-style:start -->',
      'Old content.',
      '<!-- dotai:code-style:end -->',
      '',
    ].join('\n');

    const result = upsertSection(existing, 'code-style', 'New content.');

    expect(result).not.toContain('Old content.');
    expect(result).toContain('New content.');
    expect(result).toContain('<!-- dotai:code-style:start -->');
    expect(result).toContain('<!-- dotai:code-style:end -->');
  });

  it('is idempotent — upserting same content twice produces same result', () => {
    const initial = '# My Project\n';
    const first = upsertSection(initial, 'code-style', 'Use const.');
    const second = upsertSection(first, 'code-style', 'Use const.');

    expect(first).toBe(second);
  });

  it('handles multiple sections independently', () => {
    let content = '# My Project\n';
    content = upsertSection(content, 'code-style', 'Use const.');
    content = upsertSection(content, 'security', 'Validate inputs.');

    expect(content).toContain('<!-- dotai:code-style:start -->');
    expect(content).toContain('Use const.');
    expect(content).toContain('<!-- dotai:code-style:end -->');
    expect(content).toContain('<!-- dotai:security:start -->');
    expect(content).toContain('Validate inputs.');
    expect(content).toContain('<!-- dotai:security:end -->');
  });

  it('replaces one section without disturbing another', () => {
    let content = [
      '# My Project',
      '',
      '<!-- dotai:code-style:start -->',
      'Use const.',
      '<!-- dotai:code-style:end -->',
      '',
      '<!-- dotai:security:start -->',
      'Validate inputs.',
      '<!-- dotai:security:end -->',
      '',
    ].join('\n');

    content = upsertSection(content, 'code-style', 'Updated style.');

    expect(content).toContain('Updated style.');
    expect(content).not.toContain('Use const.');
    // Security section should remain untouched
    expect(content).toContain('<!-- dotai:security:start -->');
    expect(content).toContain('Validate inputs.');
    expect(content).toContain('<!-- dotai:security:end -->');
  });

  it('handles multi-line body content', () => {
    const body = '## Style Guide\n\n- Use `const`\n- Prefer arrow functions\n';
    const result = upsertSection('', 'code-style', body);

    expect(result).toContain('## Style Guide');
    expect(result).toContain('- Use `const`');
    expect(result).toContain('- Prefer arrow functions');
  });

  it('ensures trailing newline', () => {
    const result = upsertSection('', 'test', 'body');
    expect(result.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeSection
// ---------------------------------------------------------------------------

describe('removeSection', () => {
  it('removes a section from content', () => {
    const content = [
      '# My Project',
      '',
      '<!-- dotai:code-style:start -->',
      'Use const.',
      '<!-- dotai:code-style:end -->',
      '',
    ].join('\n');

    const result = removeSection(content, 'code-style');

    expect(result).not.toContain('<!-- dotai:code-style:start -->');
    expect(result).not.toContain('Use const.');
    expect(result).not.toContain('<!-- dotai:code-style:end -->');
    expect(result).toContain('# My Project');
  });

  it('returns content unchanged when section not found', () => {
    const content = '# My Project\n\nSome content.\n';
    const result = removeSection(content, 'nonexistent');

    expect(result).toBe(content);
  });

  it('removes only the targeted section', () => {
    const content = [
      '# My Project',
      '',
      '<!-- dotai:code-style:start -->',
      'Use const.',
      '<!-- dotai:code-style:end -->',
      '',
      '<!-- dotai:security:start -->',
      'Validate inputs.',
      '<!-- dotai:security:end -->',
      '',
    ].join('\n');

    const result = removeSection(content, 'code-style');

    expect(result).not.toContain('<!-- dotai:code-style:start -->');
    expect(result).not.toContain('Use const.');
    expect(result).toContain('<!-- dotai:security:start -->');
    expect(result).toContain('Validate inputs.');
    expect(result).toContain('<!-- dotai:security:end -->');
  });

  it('cleans up surrounding blank lines', () => {
    const content = [
      '# My Project',
      '',
      '<!-- dotai:code-style:start -->',
      'Use const.',
      '<!-- dotai:code-style:end -->',
      '',
      'Footer content.',
      '',
    ].join('\n');

    const result = removeSection(content, 'code-style');

    // Should not have excessive blank lines
    expect(result).not.toContain('\n\n\n');
  });

  it('returns empty string when removing the only section from empty file', () => {
    const content = [
      '<!-- dotai:code-style:start -->',
      'Use const.',
      '<!-- dotai:code-style:end -->',
    ].join('\n');

    const result = removeSection(content, 'code-style');

    expect(result).toBe('');
  });

  it('handles section at the beginning of content', () => {
    const content = [
      '<!-- dotai:code-style:start -->',
      'Use const.',
      '<!-- dotai:code-style:end -->',
      '',
      'Other content.',
      '',
    ].join('\n');

    const result = removeSection(content, 'code-style');

    expect(result).not.toContain('dotai:code-style');
    expect(result).toContain('Other content.');
  });

  it('handles section at the end of content', () => {
    const content = [
      'Some content.',
      '',
      '<!-- dotai:code-style:start -->',
      'Use const.',
      '<!-- dotai:code-style:end -->',
      '',
    ].join('\n');

    const result = removeSection(content, 'code-style');

    expect(result).not.toContain('dotai:code-style');
    expect(result).toContain('Some content.');
    expect(result.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasSection
// ---------------------------------------------------------------------------

describe('hasSection', () => {
  it('returns true when section exists', () => {
    const content = [
      '<!-- dotai:code-style:start -->',
      'Use const.',
      '<!-- dotai:code-style:end -->',
    ].join('\n');

    expect(hasSection(content, 'code-style')).toBe(true);
  });

  it('returns false when section does not exist', () => {
    const content = '# My Project\n';

    expect(hasSection(content, 'code-style')).toBe(false);
  });

  it('returns false when only start marker exists', () => {
    const content = '<!-- dotai:code-style:start -->\nSome content.';

    expect(hasSection(content, 'code-style')).toBe(false);
  });

  it('returns false when only end marker exists', () => {
    const content = 'Some content.\n<!-- dotai:code-style:end -->';

    expect(hasSection(content, 'code-style')).toBe(false);
  });

  it('returns false when end marker comes before start marker', () => {
    const content = [
      '<!-- dotai:code-style:end -->',
      'content',
      '<!-- dotai:code-style:start -->',
    ].join('\n');

    expect(hasSection(content, 'code-style')).toBe(false);
  });

  it('returns false for empty content', () => {
    expect(hasSection('', 'code-style')).toBe(false);
  });

  it('distinguishes between different section names', () => {
    const content = [
      '<!-- dotai:code-style:start -->',
      'Use const.',
      '<!-- dotai:code-style:end -->',
    ].join('\n');

    expect(hasSection(content, 'code-style')).toBe(true);
    expect(hasSection(content, 'security')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractSection
// ---------------------------------------------------------------------------

describe('extractSection', () => {
  it('extracts section content', () => {
    const content = [
      '<!-- dotai:code-style:start -->',
      'Use const over let.',
      '<!-- dotai:code-style:end -->',
    ].join('\n');

    expect(extractSection(content, 'code-style')).toBe('Use const over let.');
  });

  it('returns null when section does not exist', () => {
    expect(extractSection('# My Project\n', 'code-style')).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(extractSection('', 'code-style')).toBeNull();
  });

  it('extracts multi-line content', () => {
    const content = [
      '<!-- dotai:code-style:start -->',
      '## Style Guide',
      '',
      '- Use const',
      '- Prefer arrow functions',
      '<!-- dotai:code-style:end -->',
    ].join('\n');

    const extracted = extractSection(content, 'code-style');
    expect(extracted).toBe('## Style Guide\n\n- Use const\n- Prefer arrow functions');
  });

  it('extracts the correct section when multiple exist', () => {
    const content = [
      '<!-- dotai:code-style:start -->',
      'Style content.',
      '<!-- dotai:code-style:end -->',
      '',
      '<!-- dotai:security:start -->',
      'Security content.',
      '<!-- dotai:security:end -->',
    ].join('\n');

    expect(extractSection(content, 'code-style')).toBe('Style content.');
    expect(extractSection(content, 'security')).toBe('Security content.');
  });

  it('returns empty string for empty section body', () => {
    const content = ['<!-- dotai:code-style:start -->', '', '<!-- dotai:code-style:end -->'].join(
      '\n'
    );

    expect(extractSection(content, 'code-style')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Round-trip: upsert then extract
// ---------------------------------------------------------------------------

describe('round-trip', () => {
  it('extracting after upserting returns the same body', () => {
    const body = '## Rule\n\n- Do this\n- Do that';
    const content = upsertSection('', 'test-rule', body);
    const extracted = extractSection(content, 'test-rule');

    expect(extracted).toBe(body);
  });

  it('upsert → extract → upsert is idempotent', () => {
    const body = 'Simple body.';
    const first = upsertSection('# Project\n', 'rule-1', body);
    const extracted = extractSection(first, 'rule-1');
    const second = upsertSection(first, 'rule-1', extracted!);

    expect(first).toBe(second);
  });

  it('upsert → remove → hasSection returns false', () => {
    let content = upsertSection('# Project\n', 'rule-1', 'Body.');
    expect(hasSection(content, 'rule-1')).toBe(true);

    content = removeSection(content, 'rule-1');
    expect(hasSection(content, 'rule-1')).toBe(false);
  });

  it('multiple upserts then selective removes', () => {
    let content = '# My AGENTS.md\n';
    content = upsertSection(content, 'rule-a', 'A content.');
    content = upsertSection(content, 'rule-b', 'B content.');
    content = upsertSection(content, 'rule-c', 'C content.');

    expect(hasSection(content, 'rule-a')).toBe(true);
    expect(hasSection(content, 'rule-b')).toBe(true);
    expect(hasSection(content, 'rule-c')).toBe(true);

    content = removeSection(content, 'rule-b');

    expect(hasSection(content, 'rule-a')).toBe(true);
    expect(hasSection(content, 'rule-b')).toBe(false);
    expect(hasSection(content, 'rule-c')).toBe(true);
    expect(extractSection(content, 'rule-a')).toBe('A content.');
    expect(extractSection(content, 'rule-c')).toBe('C content.');
  });
});
