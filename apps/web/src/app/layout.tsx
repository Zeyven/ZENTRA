import type { ReactNode } from 'react';
import '@ayra/ui/styles.css';
export const metadata = { title: 'AYRA · 工作空间', description: 'AYRA 通用智能体工作空间' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
