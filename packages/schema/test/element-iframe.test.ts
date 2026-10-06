import { describe, expect, it } from 'vitest';

import { iframeUrlIssue, pdfUrlIssue } from '../src/element-iframe.js';

describe('iframe element URL', () => {
  it('accepts an absolute HTTPS page', () => {
    expect(iframeUrlIssue('https://example.test/embed/news?id=1')).toBeNull();
  });

  it('rejects insecure, relative, and credential-bearing URLs', () => {
    expect(iframeUrlIssue('http://example.test/embed')).toMatch(/https/);
    expect(iframeUrlIssue('/embed')).toMatch(/absolute/);
    expect(iframeUrlIssue('https://user:secret@example.test/embed')).toMatch(/credentials/);
  });
});

describe('pdf element URL', () => {
  it('accepts only the published relative asset paths', () => {
    expect(pdfUrlIssue('/api/assets/worksheet-1')).toBeNull();
    expect(pdfUrlIssue('/api/sessions/ABC123/assets/worksheet-1')).toBeNull();
    for (const path of ['/handout.pdf', '/api/assets/../private', '/api/assets/%2e%2e', '//example.test/handout.pdf']) expect(pdfUrlIssue(path)).not.toBeNull();
  });
  it('accepts HTTPS document addresses without requiring a .pdf suffix', () => {
    expect(pdfUrlIssue('https://example.test/documents/handout?id=42')).toBeNull();
  });

  it('rejects insecure and credential-bearing document addresses', () => {
    expect(pdfUrlIssue('http://example.test/handout.pdf')).toMatch(/https/);
    expect(pdfUrlIssue('https://user:secret@example.test/handout.pdf')).toMatch(/credentials/);
  });
});
