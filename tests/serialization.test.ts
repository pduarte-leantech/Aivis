import { it, expect } from 'vitest';
import { exposeCase } from '../src/lib/serialization';
import { getDemoCases } from '../src/lib/demo';
it('never releases draft clinical text to an integration', () => {
  const c = getDemoCases()[0];
  expect(exposeCase(c, true).report).toBeNull();
  expect(exposeCase(c, false).report).toEqual(c.report);
  expect(exposeCase(c, true).pdf_path).toBeNull();
});
it('releases approved text without exposing private storage paths', () => {
  const c = getDemoCases()[1];
  c.pdf_path = 'private/tenant/report.pdf';
  c.exams![0].storage_path = 'private/exam';
  const response = exposeCase(c, true);
  expect(response.report).toEqual(c.report);
  expect(response.pdf_path).toBeNull();
  expect(response.exams![0].storage_path).toBe('');
  expect(c.pdf_path).toBe('private/tenant/report.pdf');
});
