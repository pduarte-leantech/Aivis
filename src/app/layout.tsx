import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Aivis · Inteligência para o cuidado',
  description: 'Apoio à decisão clínica, com revisão médica e rastreabilidade.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
