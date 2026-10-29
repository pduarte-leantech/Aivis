import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function nav(page: import('@playwright/test').Page, label: string) {
  if (test.info().project.name === 'mobile')
    await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('button', { name: label, exact: true })
    .click();
}
test('dashboard, filters, navigation and PDF preview work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Visão geral', exact: true })).toBeVisible();
  await expect(page.getByText('DEMONSTRAÇÃO', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Período do gráfico' }).selectOption('12');
  await expect(page.getByRole('img', { name: /exames/ })).toBeVisible();
  await nav(page, 'Casos clínicos');
  await page.getByRole('textbox', { name: 'Buscar paciente ou caso' }).fill('Marina');
  await expect(page.getByRole('button', { name: 'Abrir caso DEMO-1048' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir caso DEMO-1047' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir caso DEMO-1048' }).click();
  await expect(page.getByRole('heading', { name: 'Relatório clínico', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Visualizar PDF' }).click();
  await expect(page.getByTitle('Prévia do relatório clínico em PDF')).toHaveAttribute(
    'src',
    /^blob:/,
  );
  expect(errors).toEqual([]);
});
test('doctor can edit, save and approve a demo report with explicit confirmation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir caso DEMO-1048' }).click();
  await page
    .getByRole('textbox', { name: 'Síntese clínica' })
    .fill('Síntese fictícia revisada pelo médico para testar o fluxo de aprovação.');
  await expect(page.getByRole('button', { name: 'Aprovar relatório', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('textbox', { name: 'Síntese clínica' })).toHaveValue(
    /revisada pelo médico/,
  );
  await page.getByRole('button', { name: 'Aprovar relatório', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Simular aprovação' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar aprovação' }).click();
  await expect(page.getByText('Relatório aprovado e preservado')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Síntese clínica' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Baixar PDF' })).toBeVisible();
});
test('new case validates, simulates analysis and can be rejected', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Novo caso', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome do paciente' }).fill('Paciente fictício E2E');
  await page.getByRole('textbox', { name: 'Identificador', exact: true }).fill('E2E-001');
  await page
    .getByRole('textbox', { name: 'Anamnese', exact: true })
    .fill('Histórico exclusivamente fictício para testar o fluxo completo da plataforma.');
  await page.getByRole('button', { name: 'Criar caso', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paciente fictício E2E' })).toBeVisible();
  await page.getByLabel('Enviar exames').setInputFiles({
    name: 'teste.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 ficticio'),
  });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Simular rascunho' }).click();
  await page.getByRole('button', { name: 'Recusar', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Motivo da recusa' })
    .fill('Dados insuficientes neste caso fictício de teste.');
  await page.getByRole('button', { name: 'Confirmar recusa' }).click();
  await expect(page.getByText('Relatório recusado', { exact: true })).toBeVisible();
});
test('team and API controls behave without pretending to send real invitations', async ({
  page,
}) => {
  await page.goto('/');
  await nav(page, 'Equipe médica');
  await page.getByRole('button', { name: 'Convidar profissional' }).click();
  await page.getByRole('textbox', { name: 'Nome completo' }).fill('Médico de teste');
  await page.getByRole('textbox', { name: 'E-mail', exact: true }).fill('test@example.invalid');
  await page.getByRole('textbox', { name: 'Registro profissional' }).fill('DEMO-123');
  await page.getByRole('button', { name: 'Enviar convite', exact: true }).click();
  await expect(page.getByText('Médico de teste', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Nenhum convite foi enviado');
  await nav(page, 'API e integrações');
  await page.getByRole('textbox', { name: 'Nome da integração' }).fill('Teste E2E');
  await page.getByRole('button', { name: 'Gerar chave' }).click();
  await expect(page.getByText('aiv_DEMONSTRACAO_SEM_VALIDADE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Já salvei a chave' }).click();
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Revogar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revogada', exact: true })).toBeDisabled();
});
test('no horizontal overflow and no accessibility violations', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  await page.screenshot({
    path: `test-results/dashboard-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, reason: n.failureSummary })),
    })),
  ).toEqual([]);
});
test('unauthenticated real APIs fail closed and security headers are applied', async ({
  request,
}) => {
  const r = await request.get('/api/v1/cases');
  expect(r.status()).toBe(503);
  expect(await r.json()).toMatchObject({ error: expect.stringContaining('Supabase') });
  const page = await request.get('/');
  expect(page.headers()['x-content-type-options']).toBe('nosniff');
  expect(page.headers()['content-security-policy']).toContain("object-src 'none'");
  const origin = await request.post('/api/auth', {
    data: { email: 'test@example.invalid', password: 'not-a-real-password' },
    headers: { origin: 'https://attacker.invalid' },
  });
  expect(origin.status()).toBe(403);
});

test('DICOM is the primary upload format and has a dedicated image preview', async ({ page }) => {
  await page.goto('/');
  await nav(page, 'Casos clínicos');
  await page.getByRole('button', { name: 'Abrir caso DEMO-1046' }).click();
  const input = page.getByLabel('Enviar exames');
  await expect(input).toHaveAttribute('accept', /\.dicom.*\.dcm.*application\/dicom/);
  await page.getByRole('button', { name: 'Visualizar DICOM Radiografia_torax.dicom' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Imagens DICOM · Radiografia_torax.dicom' }),
  ).toBeVisible();
  await expect(
    page.getByText('Na demonstração, somente o nome do arquivo é listado.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fechar janela' }).click();
  await input.setInputFiles({
    name: 'segundo_exame.DICOM',
    mimeType: 'application/octet-stream',
    buffer: Buffer.concat([Buffer.alloc(128), Buffer.from('DICM')]),
  });
  await expect(
    page.getByRole('button', { name: 'Visualizar DICOM segundo_exame.DICOM' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('conteúdo não enviado');
});
